#!/bin/bash
# Sambungkan nginx employee-rpg (webserver-101) ke backend privat di Mac mini.
#   server/deploy/sambung-nginx.sh
# Menulis /etc/nginx/snippets/kantor-rpg-api.conf (0600 root, berisi header
# rahasia proxy) dan menyisipkan `include` di vhost, dengan backup + nginx -t.
# Rollback: sudo cp <backup> /etc/nginx/sites-available/employee-rpg.air-buddy.site && sudo nginx -t && sudo systemctl reload nginx
set -euo pipefail
HOST=webserver-101
VHOST=/etc/nginx/sites-available/employee-rpg.air-buddy.site
SNIP=/etc/nginx/snippets/kantor-rpg-api.conf
SECRET_FILE="$HOME/.hermes/kantor-rpg/data/proxy-secret"
# Upstream: KANTOR_RPG_UPSTREAM, atau IP Tailscale mesin backend ini, atau contoh LAN.
BACKEND_IP="$(tailscale ip -4 2>/dev/null | head -1)"
UPSTREAM="${KANTOR_RPG_UPSTREAM:-http://${BACKEND_IP:-192.168.1.10}:3242}"
[ -s "$SECRET_FILE" ] || { echo "proxy-secret belum ada; jalankan pasang-mac.sh dulu" >&2; exit 2; }
STAMP=$(date +%Y%m%d-%H%M%S)
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
{
  echo "# kantor-rpg backend privat (ADR-016). Dibuat sambung-nginx.sh $STAMP."
  echo "location ^~ /api/ {"
  echo "  proxy_pass $UPSTREAM;"
  echo "  proxy_http_version 1.1;"
  echo "  proxy_set_header Host \$host;"
  echo "  proxy_set_header X-Real-IP \$http_cf_connecting_ip;"
  echo "  proxy_set_header X-Kantor-Proxy \"$(cat "$SECRET_FILE")\";"
  echo "  proxy_set_header Accept-Encoding \$http_accept_encoding;"
  echo "  proxy_connect_timeout 3s;"
  echo "  proxy_read_timeout 30s;"
  echo "  client_max_body_size 16k;"
  echo "  proxy_intercept_errors off;"
  echo "  add_header X-Robots-Tag \"noindex, nofollow\" always;"
  echo "}"
} > "$TMP"
scp -q "$TMP" "$HOST:/tmp/kantor-rpg-api.conf"
ssh "$HOST" "set -e
  sudo -n install -m 0600 -o root -g root /tmp/kantor-rpg-api.conf $SNIP && rm -f /tmp/kantor-rpg-api.conf
  sudo -n cp -a $VHOST /var/backups/employee-rpg-before-api-$STAMP.conf
  if ! sudo -n grep -q 'include $SNIP;' $VHOST; then
    sudo -n sed -i 's#^ location ^~ /assets/# include $SNIP;\n location ^~ /assets/#' $VHOST
  fi
  if sudo -n nginx -t 2>/tmp/nginx-t.log; then sudo -n systemctl reload nginx; echo NGINX_OK backup=/var/backups/employee-rpg-before-api-$STAMP.conf
  else cat /tmp/nginx-t.log; sudo -n cp -a /var/backups/employee-rpg-before-api-$STAMP.conf $VHOST; echo NGINX_ROLLED_BACK; exit 1; fi"
