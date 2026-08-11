class GreetingRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async ensureGuild({ guildId, name = null, ownerUserId = null }) {
    await this.pool.query(
      `insert into guilds (id, name, owner_user_id)
       values ($1, coalesce($2, $1), $3)
       on conflict (id) do update
         set name = coalesce($2, guilds.name),
             owner_user_id = coalesce($3, guilds.owner_user_id),
             updated_at = now()`,
      [guildId, name, ownerUserId],
    );
  }

  async createSchedule(input) {
    await this.ensureGuild(input);
    const { rows } = await this.pool.query(
      `insert into greeting_schedules (
         guild_id, name, channel_id, role_id, occasion, timezone,
         local_time, days_of_week, adm4, location_label,
         grace_minutes, enabled, created_by_user_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12)
       returning *`,
      [
        input.guildId,
        input.name,
        input.channelId,
        input.roleId,
        input.occasion,
        input.timezone,
        input.localTime,
        input.daysOfWeek,
        input.adm4,
        input.locationLabel,
        input.graceMinutes,
        input.actorUserId,
      ],
    );
    return rows[0];
  }

  async listSchedules(guildId) {
    const { rows } = await this.pool.query(
      `select * from greeting_schedules
        where guild_id = $1
        order by name`,
      [guildId],
    );
    return rows;
  }

  async findSchedule(guildId, identifier) {
    const { rows } = await this.pool.query(
      `select * from greeting_schedules
        where guild_id = $1 and (id::text = $2 or lower(name) = lower($2))
        limit 1`,
      [guildId, identifier],
    );
    return rows[0] ?? null;
  }

  async setScheduleEnabled({ guildId, identifier, enabled }) {
    const { rows } = await this.pool.query(
      `update greeting_schedules
          set enabled = $3, updated_at = now()
        where guild_id = $1 and (id::text = $2 or lower(name) = lower($2))
        returning *`,
      [guildId, identifier, enabled],
    );
    return rows[0] ?? null;
  }

  async updateSchedule({ guildId, identifier, changes }) {
    const allowed = {
      name: 'name',
      channelId: 'channel_id',
      roleId: 'role_id',
      occasion: 'occasion',
      timezone: 'timezone',
      localTime: 'local_time',
      daysOfWeek: 'days_of_week',
      adm4: 'adm4',
      locationLabel: 'location_label',
      graceMinutes: 'grace_minutes',
    };
    const entries = Object.entries(changes).filter(
      ([key, value]) => allowed[key] && value !== undefined,
    );

    if (entries.length === 0) {
      return this.findSchedule(guildId, identifier);
    }

    const values = [guildId, identifier];
    const setters = entries.map(([key, value], index) => {
      values.push(value);
      return `${allowed[key]} = $${index + 3}`;
    });
    const { rows } = await this.pool.query(
      `update greeting_schedules
          set ${setters.join(', ')}, updated_at = now()
        where guild_id = $1 and (id::text = $2 or lower(name) = lower($2))
        returning *`,
      values,
    );
    return rows[0] ?? null;
  }

  async deleteSchedule({ guildId, identifier }) {
    const { rows } = await this.pool.query(
      `delete from greeting_schedules
        where guild_id = $1 and (id::text = $2 or lower(name) = lower($2))
        returning *`,
      [guildId, identifier],
    );
    return rows[0] ?? null;
  }

  async setGlobalEnabled(guildId, enabled) {
    const { rows } = await this.pool.query(
      `update guilds
          set scheduler_enabled = $2, updated_at = now()
        where id = $1
        returning scheduler_enabled`,
      [guildId, enabled],
    );
    return rows[0]?.scheduler_enabled ?? false;
  }

  async getGlobalEnabled(guildId) {
    const { rows } = await this.pool.query(
      'select scheduler_enabled from guilds where id = $1',
      [guildId],
    );
    return rows[0]?.scheduler_enabled ?? false;
  }

  async claimDueRuns(limit = 10) {
    const client = await this.pool.connect();

    try {
      await client.query('begin');
      await client.query(`
        update greeting_runs
           set status = 'unknown', completed_at = now(),
               error_code = 'CLAIM_TIMEOUT'
         where status = 'claimed'
           and claimed_at < now() - interval '10 minutes'
      `);
      await client.query(`
        with occurrences as (
          select s.id,
                 (((now() at time zone s.timezone)::date + s.local_time)
                    at time zone s.timezone) as scheduled_for
            from greeting_schedules s
            join guilds g on g.id = s.guild_id
           where s.enabled and g.scheduler_enabled
             and extract(isodow from now() at time zone s.timezone)::smallint
                   = any(s.days_of_week)
        )
        insert into greeting_runs (schedule_id, scheduled_for, status, completed_at, error_code)
        select o.id, o.scheduled_for, 'missed', now(), 'OUTSIDE_GRACE'
          from occurrences o
          join greeting_schedules s on s.id = o.id
         where now() >= o.scheduled_for + make_interval(mins => s.grace_minutes)
           and now() < o.scheduled_for + interval '1 day'
        on conflict (schedule_id, scheduled_for) do nothing
      `);
      const { rows } = await client.query(
        `with candidates as (
           select s.*,
                  (((now() at time zone s.timezone)::date + s.local_time)
                    at time zone s.timezone) as scheduled_for
             from greeting_schedules s
             join guilds g on g.id = s.guild_id
            where s.enabled and g.scheduler_enabled
              and extract(isodow from now() at time zone s.timezone)::smallint
                    = any(s.days_of_week)
              and now() >= (((now() at time zone s.timezone)::date + s.local_time)
                    at time zone s.timezone)
              and now() < (((now() at time zone s.timezone)::date + s.local_time)
                    at time zone s.timezone) + make_interval(mins => s.grace_minutes)
            order by s.local_time
            for update of s skip locked
            limit $1
         ), inserted as (
           insert into greeting_runs (schedule_id, scheduled_for, status)
           select id, scheduled_for, 'claimed' from candidates
           on conflict (schedule_id, scheduled_for) do nothing
           returning id as run_id, schedule_id, scheduled_for
         )
         select i.run_id, i.scheduled_for, c.*
           from inserted i
           join candidates c on c.id = i.schedule_id`,
        [Math.min(Math.max(limit, 1), 25)],
      );
      await client.query('commit');
      return rows;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeRun({ runId, status, messageId = null, providerStatus = {}, errorCode = null }) {
    const { rows } = await this.pool.query(
      `update greeting_runs
          set status = $2, discord_message_id = $3,
              provider_status = $4::jsonb, error_code = $5,
              completed_at = now()
        where id = $1 and status = 'claimed'
        returning *`,
      [runId, status, messageId, JSON.stringify(providerStatus), errorCode],
    );
    return rows[0] ?? null;
  }

  async listRuns(guildId, limit = 100) {
    const { rows } = await this.pool.query(
      `select r.*, s.name as schedule_name, s.channel_id, s.role_id
         from greeting_runs r
         join greeting_schedules s on s.id = r.schedule_id
        where s.guild_id = $1
        order by r.scheduled_for desc
        limit $2`,
      [guildId, Math.min(Math.max(limit, 1), 200)],
    );
    return rows;
  }
}

module.exports = { GreetingRepository };
