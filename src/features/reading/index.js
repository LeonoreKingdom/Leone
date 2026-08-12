const { READING_CONFIGS, createReadingCommand } = require('./reading.command');

module.exports = Object.values(READING_CONFIGS).map(createReadingCommand);
