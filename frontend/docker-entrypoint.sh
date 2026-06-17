#!/bin/sh
echo "window.__ENV__ = { API_URL: '${API_URL}' };" > /usr/share/nginx/html/env.js
exec "$@"
