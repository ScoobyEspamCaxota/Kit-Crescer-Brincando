"use strict";

const { envInfo, json } = require("./_shared");

exports.handler = async () => json(200, envInfo());
