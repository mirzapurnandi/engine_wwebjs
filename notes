#!/bin/bash
set -e

# === Variabel ===
DOMAIN="engine01.wasend.id"
REPO="https://github.com/mirzapurnandi/engine_wwebjs.git"
APP_DIR="/var/www/engine_wwebjs"

# === Update & Dependensi ===
echo "[1/8] Update system..."
sudo apt update -y && sudo apt upgrade -y
sudo apt install -y curl wget git gnupg build-essential ufw unzip

# === Install Node.js 22 ===
echo "[2/8] Install Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g npm@latest pm2

# === Install MongoDB 7 ===
echo "[3/8] Install MongoDB 7..."
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor

echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list

sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod

# === Clone Project ===
echo "[4/8] Clone repository..."
sudo mkdir -p $APP_DIR
sudo chown -R $USER:$USER $APP_DIR
if [ ! -d "$APP_DIR/.git" ]; then
  git clone $REPO $APP_DIR
else
  cd $APP_DIR && git pull
fi

cd $APP_DIR
echo "[5/8] Install dependencies..."
npm install

echo "[6/8] Start app with PM2..."
pm2 start npm --name "engine_wwebjs" -- run start
pm2 startup systemd -u $USER --hp $HOME
pm2 save

# === Nginx & SSL ===
echo "[7/8] Setup Nginx + SSL..."
sudo apt install -y nginx certbot python3-certbot-nginx

NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
sudo tee $NGINX_CONF > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000; # ganti port sesuai app kamu
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

# SSL Let's Encrypt
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN

# === Zsh & Oh My Zsh ===
echo "[8/8] Install Zsh & Oh My Zsh..."
sudo apt install -y zsh
chsh -s $(which zsh)
export RUNZSH=no
export CHSH=no
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
sed -i 's/^plugins=(git)$/plugins=(git zsh-autosuggestions zsh-syntax-highlighting)/' ~/.zshrc
sed -i 's/^ZSH_THEME=".*"/ZSH_THEME="agnoster"/' ~/.zshrc

echo "✅ Deployment selesai!"
