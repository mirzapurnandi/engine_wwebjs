#!/bin/bash
# Script otomatis setup swap di Ubuntu untuk server 4 Core, 2GB RAM, 20GB storage
# Swap size: 4G

SWAP_SIZE=4G
SWAP_FILE=/swapfile

echo "=== Setup Swap ${SWAP_SIZE} ==="

# 1. Buat swapfile (gunakan fallocate, fallback ke dd jika gagal)
sudo fallocate -l $SWAP_SIZE $SWAP_FILE || sudo dd if=/dev/zero of=$SWAP_FILE bs=1M count=4096

# 2. Set permission agar aman
sudo chmod 600 $SWAP_FILE

# 3. Format swap
sudo mkswap $SWAP_FILE

# 4. Aktifkan swap
sudo swapon $SWAP_FILE

# 5. Tambahkan ke fstab biar permanen
if ! grep -q "$SWAP_FILE" /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab
fi

# 6. Optimasi swappiness (supaya swap tidak terlalu agresif)
if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
    echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
else
    sudo sed -i 's/^vm.swappiness=.*/vm.swappiness=10/' /etc/sysctl.conf
fi

# 7. Reload sysctl
sudo sysctl -p

echo "=== Swap berhasil dibuat (${SWAP_SIZE}) ==="
swapon --show
free -h
