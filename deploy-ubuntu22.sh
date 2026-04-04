#!/bin/bash
set -e

# === Variabel ===
DOMAIN="engine07.wasend.id"
REPO="https://github.com/mirzapurnandi/engine_wwebjs.git"
APP_DIR="/var/www/engine_wwebjs"

echo "=============================================="
echo "🚀 DEPLOY STARTED (Ubuntu 22.04)"
echo "=============================================="

# === Update & Dependensi ===
echo "[1/10] Updating system..."
sudo apt update -y && sudo apt upgrade -y
sudo apt install -y curl wget git gnupg build-essential ufw unzip apt-transport-https software-properties-common

# === Install Node.js 22 ===
echo "[2/10] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g npm@latest pm2

# === Install MongoDB 8 (Fix Key + Ubuntu 24.04) ===
echo "[3/10] Installing MongoDB 8..."
sudo apt update
sudo apt install gnupg curl
# Add GPG Key (new recommended endpoint)
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg \
   --dearmor

# Create apt source list
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list

sudo apt update -y
sudo apt install -y mongodb-org

# Start MongoDB service
sudo systemctl enable --now mongod

echo "⏳ Checking MongoDB status..."
sleep 3
sudo systemctl status mongod --no-pager || true

# === Install Google Chrome Stable ===
echo "[4/10] Installing Google Chrome..."
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg

echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list

sudo apt update
sudo apt install -y google-chrome-stable
sudo apt install -y fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1

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
# pm2 startup systemd -u $USER --hp $HOME
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
echo "✅ DEPLOYMENT COMPLETE — SERVER READY!"
echo "Domain: https://$DOMAIN"
echo "PM2 App: engine_wwebjs"
echo "=============================================="
