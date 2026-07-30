const {
  mkdir,
  readFile,
  rename,
  writeFile,
} = require('node:fs/promises');
const path = require('node:path');

function createEmptyState() {
  return {
    version: 1,
    members: {},
    requests: [],
    edges: [],
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function validateState(state) {
  if (
    !state ||
    state.version !== 1 ||
    !state.members ||
    !Array.isArray(state.requests) ||
    !Array.isArray(state.edges)
  ) {
    throw new Error('The Leone Bonds data file is invalid.');
  }

  return state;
}

class JsonBondStore {
  /**
   * @param {{filePath?: string}} options
   */
  constructor(options = {}) {
    this.filePath =
      options.filePath ??
      process.env.BONDS_DATA_FILE ??
      path.resolve(
        __dirname,
        '../../../data/bonds.json',
      );
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return validateState(JSON.parse(contents));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return createEmptyState();
      }

      throw error;
    }
  }

  async save(state) {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;

    await mkdir(directory, { recursive: true });
    await writeFile(
      temporaryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
    await rename(temporaryPath, this.filePath);
  }

  /**
   * @template T
   * @param {(state: ReturnType<typeof createEmptyState>) => T | Promise<T>} reader
   * @returns {Promise<T>}
   */
  async read(reader) {
    await this.queue;
    return reader(cloneState(await this.load()));
  }

  /**
   * Serialize mutations so concurrent interactions cannot overwrite
   * one another.
   *
   * @template T
   * @param {(state: ReturnType<typeof createEmptyState>) => T | Promise<T>} mutator
   * @returns {Promise<T>}
   */
  async transact(mutator) {
    const operation = this.queue.then(async () => {
      const state = await this.load();
      const result = await mutator(state);

      validateState(state);
      await this.save(state);
      return result;
    });

    this.queue = operation.catch(() => {});
    return operation;
  }
}

class MemoryBondStore {
  constructor(initialState = createEmptyState()) {
    this.state = cloneState(initialState);
    this.queue = Promise.resolve();
  }

  async read(reader) {
    await this.queue;
    return reader(cloneState(this.state));
  }

  async transact(mutator) {
    const operation = this.queue.then(async () => {
      const nextState = cloneState(this.state);
      const result = await mutator(nextState);

      validateState(nextState);
      this.state = nextState;
      return result;
    });

    this.queue = operation.catch(() => {});
    return operation;
  }
}

module.exports = {
  JsonBondStore,
  MemoryBondStore,
  createEmptyState,
};
