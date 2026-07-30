const aboutCommand = require('./about.command');
const rulesCommand = require('./rules.command');
const serverCommand = require('./server.command');
const serverMapCommand = require('./server-map/command');
const staffCommand = require('./staff.command');

module.exports = [
  aboutCommand,
  staffCommand,
  serverMapCommand,
  rulesCommand,
  serverCommand,
];
