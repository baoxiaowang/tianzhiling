const path = require('path')

module.exports = {
  root: true,
  extends: ['taro/vue3'],
  parserOptions: {
    babelOptions: {
      configFile: path.join(__dirname, 'babel.config.js'),
    },
  },
}
