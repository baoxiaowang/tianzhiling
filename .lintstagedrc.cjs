const adminBin = (command) => `./apps/admin/node_modules/.bin/${command}`;

module.exports = {
  'apps/admin/**/*.{js,ts,jsx,tsx}': [
    `${adminBin('prettier')} --write`,
    `${adminBin('eslint')} --fix`,
  ],
  'apps/admin/**/*.vue': [
    `${adminBin('stylelint')} --fix`,
    `${adminBin('prettier')} --write`,
    `${adminBin('eslint')} --fix`,
  ],
  'apps/admin/**/*.{less,css}': [
    `${adminBin('stylelint')} --fix`,
    `${adminBin('prettier')} --write`,
  ],
};
