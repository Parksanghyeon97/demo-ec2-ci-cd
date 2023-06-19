#!/bin/sh
cd /home/ec2-user
npm install forever -g
forever stop src/server.js
forever start -o out.log -e err.log src/server.js
