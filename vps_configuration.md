

sudo apt update
sudo apt install curl -y



curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

sudo apt install -y nodejs

curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
sudo install -o root -g root -m 644 microsoft.gpg /etc/apt/trusted.gpg.d/
sudo sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/edge stable main" > /etc/apt/sources.list.d/microsoft-edge-dev.list'
rm microsoft.gpg


sudo apt update

sudo apt install microsoft-edge-stable -y


sudo nano /etc/systemd/system/client.service

sudo nano /etc/systemd/system/server-ts.service

sudo nano /etc/systemd/system/admin.service


Client

[Unit]
Description=My Web Application (Development)
After=network.target

[Service]
Type=simple
User=admin_leloi
WorkingDirectory=/home/admin_leloi/confhub2-fe-client-side
ExecStart=/usr/bin/npm run dev -- -p 8386  # Thêm -- và -p
Restart=on-failure  
# Environment=NODE_ENV=development
StandardOutput=journal  
StandardError=journal  

[Install]
WantedBy=multi-user.target



Admin

[Unit]
Description=Admin Application (Development)
After=network.target

[Service]
Type=simple
User=admin_leloi
WorkingDirectory=/home/admin_leloi/confhub2-fe-admin-side
ExecStart=/usr/bin/npm run dev -- -p 1314  # Thêm -- và -p
Restart=on-failure
# Environment=NODE_ENV=development
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target




[Unit]
Description=SERVER-TS
After=network.target

[Service]
Type=simple
User=admin_leloi
WorkingDirectory=/home/admin_leloi/SERVER-TS
ExecStart=/usr/bin/npm start
Restart=on-failure  
StandardOutput=journal  
StandardError=journal  

[Install]
WantedBy=multi-user.target




sudo systemctl daemon-reload

sudo systemctl enable client.service
sudo systemctl enable admin.service
sudo systemctl enable server-ts.service
sudo systemctl enable server.service


sudo systemctl start client.service
sudo systemctl start admin.service
sudo systemctl start server-ts.service
sudo systemctl start server.service

sudo systemctl restart client.service
sudo systemctl restart admin.service
sudo systemctl restart server-ts.service
sudo systemctl restart server.service

sudo systemctl status client.service
sudo systemctl status admin.service
sudo systemctl status server-ts.service
sudo systemctl status server.service


sudo journalctl -u admin.service -f
sudo journalctl -u client.service -f
sudo journalctl -u server-ts.service -f
sudo journalctl -u server.service -f

sudo ufw allow 3001
=====================================

**1. Cài đặt Nginx:**

Nếu bạn chưa cài Nginx, hãy cài đặt nó:

```bash
sudo apt update
sudo apt install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx # Đảm bảo Nginx khởi động cùng hệ thống
```

**2. Cấu hình Firewall:**

Bạn cần cho phép truy cập qua cổng 80 (HTTP - cần cho Let's Encrypt xác thực) và 443 (HTTPS). Nếu bạn đang dùng `ufw`:

```bash
sudo ufw allow 'Nginx Full' # Lệnh này thường mở cả cổng 80 và 443
# Hoặc mở riêng lẻ:
# sudo ufw allow 80/tcp
# sudo ufw allow 443/tcp
sudo ufw reload
```
*(Nếu bạn dùng tường lửa khác hoặc tường lửa của nhà cung cấp VPS, hãy đảm bảo mở cổng 80 và 443)*.

**3. Cài đặt Certbot:**

Certbot là công cụ để tự động lấy và gia hạn chứng chỉ Let's Encrypt. Cách cài đặt được khuyến nghị hiện nay là qua `snap`:

```bash
# Gỡ bỏ certbot cũ nếu có (từ apt)
# sudo apt-get remove certbot

# Cài snapd nếu chưa có
sudo apt install snapd -y

# Cài certbot core
sudo snap install core; sudo snap refresh core

# Cài certbot và tạo liên kết để dùng lệnh certbot
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

**4. Cấu hình Nginx làm Reverse Proxy (Ban đầu cho HTTP):**

Tạo một file cấu hình Nginx cho tên miền của bạn. Chúng ta sẽ bắt đầu với HTTP để Certbot có thể xác thực, sau đó Certbot sẽ tự động nâng cấp lên HTTPS.

```bash
sudo nano /etc/nginx/sites-available/confhub.ddns.net
```

Dán nội dung sau vào file (thay `localhost:8386` nếu ứng dụng của bạn không chạy trên localhost hoặc dùng cổng khác):

```nginx
# /etc/nginx/sites-available/confhub.ddns.net

# --- Cấu hình cho Backend API (Proxy) và Frontend ---
server {
    # --- Phần HTTPS (Cổng 443) ---
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name confhub.ddns.net;

    # --- Cấu hình SSL (Do Certbot quản lý) ---
    ssl_certificate /etc/letsencrypt/live/confhub.ddns.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/confhub.ddns.net/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # --- Proxy cho Backend API (Qua /api/) ---
    # Block này PHẢI đứng TRƯỚC các location frontend
    location /api/ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://localhost:3001/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Tăng thời gian chờ phản hồi từ backend
    # Giá trị này nên đủ lớn để backend xử lý một batch
    # Ví dụ: 10 phút (600 giây). Điều chỉnh nếu cần.
    # Nếu một batch 50 items có thể mất nhiều hơn, hãy tăng thêm.
    # Frontend của bạn đang đặt timeout axios là 2 giờ (7200000ms),
    # nhưng không nên đặt Nginx timeout quá cao như vậy.
    # Hãy ước lượng thời gian tối đa cho 1 batch.
    proxy_connect_timeout 600s;
    proxy_send_timeout 600s;
    proxy_read_timeout 600s; # Quan trọng nhất

    # Cân nhắc thêm nếu payload request lớn (dù không phải nguyên nhân 504)
    # client_max_body_size 50M; # Ví dụ: cho phép payload lên tới 50MB
    }

    # --- Proxy cho Frontend ADMIN (Qua /admin/) ---
    # Block này sẽ xử lý các yêu cầu tới confhub.ddns.net/admin/
    # Nó PHẢI đứng TRƯỚC 'location /' (cho client frontend)
    location /admin/ {


        # Địa chỉ frontend admin của bạn
        proxy_pass http://localhost:1314;

        # Các header quan trọng
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Hỗ trợ WebSocket
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    
    # --- Proxy cho Frontend CLIENT (Next.js) ---
    # Block này xử lý tất cả các yêu cầu còn lại không khớp với /api/ hoặc /admin/
    location / {
        # Địa chỉ frontend client của bạn
        proxy_pass http://localhost:8386;

        # Các header quan trọng
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Hỗ trợ WebSocket
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Optional: Cấu hình thêm
    # access_log /var/log/nginx/confhub.ddns.net.access.log;
    # error_log /var/log/nginx/confhub.ddns.net.error.log;
    # client_max_body_size 10M;
}

# --- Phần HTTP (Cổng 80) ---
# Không cần thay đổi gì ở đây
server {
    listen 80;
    listen [::]:80;

    server_name confhub.ddns.net;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

*   Lưu file (`Ctrl+X`, rồi `Y`, rồi `Enter`).
*   Kích hoạt cấu hình này bằng cách tạo symbolic link:
    ```bash
    sudo ln -s /etc/nginx/sites-available/confhub.ddns.net /etc/nginx/sites-enabled/
    ```
*   Kiểm tra cú pháp Nginx:
    ```bash
    sudo nginx -t
    ```
    Nếu thấy "syntax is ok" và "test is successful" là được.
*   Tải lại Nginx để áp dụng cấu hình mới:
    ```bash
    sudo systemctl reload nginx
    ```

Lúc này, bạn thử truy cập `http://confhub.ddns.net` (không có cổng), bạn sẽ thấy ứng dụng của mình (nếu nó đang chạy và Nginx cấu hình đúng).

**5. Lấy chứng chỉ SSL/TLS bằng Certbot:**

Chạy Certbot và để nó tự động cấu hình Nginx cho bạn:

```bash
sudo certbot --nginx -d confhub.ddns.net
```

*   Certbot sẽ hỏi địa chỉ email của bạn (để thông báo gia hạn và các vấn đề bảo mật).
*   Hỏi bạn có đồng ý với Điều khoản Dịch vụ (Terms of Service) không.
*   Hỏi bạn có muốn chia sẻ email với EFF không (tùy chọn).
*   Quan trọng: Certbot sẽ phát hiện cấu hình Nginx của bạn và hỏi bạn có muốn **tự động chuyển hướng HTTP sang HTTPS không**. **Nên chọn tùy chọn 2 (Redirect)**.

Nếu thành công, Certbot sẽ thông báo đã lấy được chứng chỉ và tự động sửa file cấu hình Nginx của bạn (`/etc/nginx/sites-available/confhub.ddns.net`) để bật HTTPS và chuyển hướng.

**6. Kiểm tra tự động gia hạn:**

Certbot thường tự động thiết lập một tác vụ (cron job hoặc systemd timer) để kiểm tra và gia hạn chứng chỉ khi sắp hết hạn. Bạn có thể kiểm tra xem nó hoạt động không (không thực sự gia hạn ngay):

```bash
sudo certbot renew --dry-run
```

**7. Truy cập ứng dụng qua HTTPS:**

Bây giờ bạn có thể truy cập ứng dụng của mình một cách an toàn qua:

`https://confhub.ddns.net/en`

Trình duyệt sẽ hiển thị biểu tượng ổ khóa, cho biết kết nối đã được mã hóa và xác thực. Truy cập `http://confhub.ddns.net/en` cũng sẽ tự động chuyển hướng sang `https`.

Chúc mừng bạn đã thiết lập HTTPS thành công!



brevo-code:bafd25fca8febe657dd731009f03f4c1