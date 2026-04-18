const { Bootstrap } = require('@midwayjs/bootstrap');

if (!process.env.MIDWAY_LOGGER_WRITEABLE_DIR) {
  process.env.MIDWAY_LOGGER_WRITEABLE_DIR = process.cwd();
}

Bootstrap.run();
