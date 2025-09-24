#!/bin/bash
set -e

# === Variabel ===
DOMAIN="engine01.wasend.id"
REPO="https://github.com/mirzapurnandi/engine_wwebjs.git"
APP_DIR="/var/www/engine_wwebjs"

# === Clone Project ===
echo "[6/9] Clone repository..."
sudo mkdir -p $APP_DIR
sudo chown -R $USER:$USER $APP_DIR
if [ ! -d "$APP_DIR/.git" ]; then
  git clone $REPO $APP_DIR
else
  cd $APP_DIR && git pull
fi

cd $APP_DIR
echo "[7/9] Install dependencies..."
npm install

echo "[8/9] Start app with PM2..."
pm2 start npm --name "engine_wwebjs" -- run start
pm2 startup systemd -u $USER --hp $HOME
pm2 save

# === Zsh & Oh My Zsh ===
echo "[9/9] Install Zsh & Oh My Zsh..."
sudo apt install -y zsh

export RUNZSH=no
export CHSH=no
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# pastikan file ~/.zshrc ada
if [ ! -f ~/.zshrc ]; then
  cp ~/.oh-my-zsh/templates/zshrc.zsh-template ~/.zshrc
fi

git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

sed -i 's/^plugins=(git)$/plugins=(git zsh-autosuggestions zsh-syntax-highlighting)/' ~/.zshrc
sed -i 's/^ZSH_THEME=".*"/ZSH_THEME="agnoster"/' ~/.zshrc

zsh
source ~/.zshrc
chsh -s $(which zsh)

echo "✅ Deployment selesai!"
