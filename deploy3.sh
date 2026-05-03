#!/bin/bash
set -e

# === Variabel ===
DOMAIN="engine11.wasend.id"
REPO="https://github.com/mirzapurnandi/engine_wwebjs.git"
APP_DIR="/var/www/engine_wwebjs"

echo "=============================================="
echo "DEPLOY STARTED (Ubuntu 24.04)"
echo "=============================================="

# === Update & Dependensi ===
echo "[1/10] Updating system..."
sudo apt update -y && sudo apt upgrade -y
sudo apt install -y curl wget git gnupg build-essential ufw unzip apt-transport-https software-properties-common

# === Install Node.js 22 ===
echo "[2/10] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# =========================================================
# 🔥 FIX NPM CORRUPT (WAJIB)
# =========================================================
echo "[3/10 FIX] Repair npm..."
sudo rm -rf /usr/lib/node_modules/npm || true
sudo rm -rf /usr/bin/npm || true
sudo rm -rf /usr/bin/npx || true

corepack enable
corepack prepare npm@10.8.2 --activate

# 🔥 FIX npm not found
# Fix npm path
export PATH="$HOME/.local/share/corepack/shims:$PATH"
export PATH="/usr/local/bin:$PATH"
export PATH="/usr/bin:$PATH"

npm -v

# install pm2
npm install -g pm2

# =========================================================

# === Install Google Chrome Stable ===
echo "[4/10] Installing Google Chrome..."
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg

echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list

sudo apt update
sudo apt install -y google-chrome-stable

# =========================================================
# 🔥 FIX PUPPETEER DEPENDENCY (BIAR GAK CRASH)
# =========================================================
echo "[FIX] Installing Chrome dependencies..."
sudo apt install -y \
  fonts-liberation \
  libappindicator3-1 \
  libasound2t64 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils
  
sudo apt install -y libgbm-dev wget gnupg
sudo apt install -y ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils
# =========================================================

# === Clone Project ===
echo "[5/10] Cloning repository..."
sudo mkdir -p $APP_DIR
sudo chown -R $USER:$USER $APP_DIR

if [ ! -d "$APP_DIR/.git" ]; then
  git clone $REPO $APP_DIR
else
  cd $APP_DIR && git pull
fi

cd $APP_DIR

echo "[6/10] Installing project dependencies..."
npm install

# === PM2 Setup ===
echo "[7/10] Starting app with PM2..."
pm2 start npm --name "engine_wwebjs" -- run start
pm2 save --force

# === Nginx + SSL ===
echo "[8/10] Setting up Nginx & SSL..."

sudo apt install -y nginx certbot python3-certbot-nginx

NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"

sudo tee $NGINX_CONF > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL
echo "[9/10] Installing SSL Certificate..."
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN || true

# === Zsh & Oh My Zsh ===
echo "[10/10] Installing Zsh & Oh My Zsh..."

sudo apt install -y zsh
chsh -s $(which zsh)
export RUNZSH=no
export CHSH=no
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

if [ ! -f ~/.zshrc ]; then
  cp ~/.oh-my-zsh/templates/zshrc.zsh-template ~/.zshrc
fi

git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

sed -i 's/^plugins=(git)$/plugins=(git zsh-autosuggestions zsh-syntax-highlighting)/' ~/.zshrc
sed -i 's/^ZSH_THEME=".*"/ZSH_THEME="agnoster"/' ~/.zshrc

zsh
source ~/.zshrc

echo "=============================================="
echo "DEPLOYMENT COMPLETE SERVER READY!"
echo "Domain: https://$DOMAIN"
echo "PM2 App: engine_wwebjs"
echo "=============================================="