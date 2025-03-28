ssh admin_leloi@172.188.242.233


sudo apt update
sudo apt install curl -y



curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

sudo apt install -y nodejs

curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
sudo install -o root -g root -m 644 microsoft.gpg /etc/apt/trusted.gpg.d/
sudo sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/edge stable main" > /etc/apt/sources.list.d/microsoft-edge-dev.list'
rm microsoft.gpg


sudo apt update

sudo apt install microsoft-edge-stable -y


sudo nano /etc/systemd/system/crawl_server.service

sudo nano /etc/systemd/system/client.service

sudo nano /etc/systemd/system/server-ts.service

[Unit]
Description=Node.js Server Application
After=network.target

[Service]
ExecStart=/usr/bin/node /home/admin_leloi/server_crawl.js
WorkingDirectory=/home/admin_leloi/
Restart=always
User=admin_leloi
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target


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


sudo systemctl start crawl_server.service
sudo systemctl start client.service
sudo systemctl start server-ts.service


sudo systemctl restart crawl_server.service
sudo systemctl status crawl_server.service
sudo systemctl status client.service
sudo systemctl status server-ts.service


sudo journalctl -u crawl_server.service
sudo journalctl -u client.service -f
sudo journalctl -u crawl_server.service


2QAA398G66NXT366LQ3NVVCP mã sendgrid



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
    # Certbot thường tự động thêm các dòng listen và ssl_certificate/key
    listen 443 ssl http2;
    listen [::]:443 ssl http2; # Cho IPv6 nếu có

    server_name confhub.ddns.net; # Tên miền của bạn

    # --- Cấu hình SSL (Do Certbot quản lý) ---
    # Đường dẫn đến chứng chỉ và khóa, Certbot sẽ điền đúng
    ssl_certificate /etc/letsencrypt/live/confhub.ddns.net/fullchain.pem; # Managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/confhub.ddns.net/privkey.pem; # Managed by Certbot

    # Các cài đặt SSL bảo mật được khuyến nghị (Certbot thường tạo các file này)
    include /etc/letsencrypt/options-ssl-nginx.conf; # Managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # Managed by Certbot

    # --- Proxy cho Backend API (Qua /api/) ---
    # Block này PHẢI đứng TRƯỚC 'location /'
    location /api/ {
        # Loại bỏ /api/ khỏi đường dẫn trước khi gửi đến backend
        # Ví dụ: /api/users -> /users
        rewrite ^/api/(.*)$ /$1 break;

        # Địa chỉ backend của bạn (Node.js)
        proxy_pass http://localhost:3001;

        # Các header quan trọng để backend nhận đúng thông tin
        proxy_set_header Host $host; # Giữ nguyên tên miền gốc
        proxy_set_header X-Real-IP $remote_addr; # IP thật của client
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; # Danh sách IP proxy đã đi qua
        proxy_set_header X-Forwarded-Proto $scheme; # Báo cho backend biết kết nối gốc là http hay https ('https')

        # Hỗ trợ WebSocket (quan trọng nếu API của bạn dùng WebSocket)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Optional: Tăng thời gian chờ nếu backend xử lý lâu
        # proxy_connect_timeout 60s;
        # proxy_send_timeout 60s;
        # proxy_read_timeout 60s;
    }

    # --- Proxy cho Frontend (Next.js) ---
    # Block này xử lý tất cả các yêu cầu còn lại không khớp với /api/
    location / {
        # Địa chỉ frontend của bạn (Next.js dev server hoặc production server)
        proxy_pass http://localhost:8386;

        # Các header quan trọng (lặp lại để đảm bảo đúng cho frontend)
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Hỗ trợ WebSocket (quan trọng nếu frontend dùng WebSocket, ví dụ Hot Module Reload của Next.js dev)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Optional: Cấu hình thêm cho logs, giới hạn kích thước body,...
    # access_log /var/log/nginx/confhub.ddns.net.access.log;
    # error_log /var/log/nginx/confhub.ddns.net.error.log;
    # client_max_body_size 10M; # Ví dụ: giới hạn upload 10MB
}

# --- Phần HTTP (Cổng 80) ---
# Server block này chủ yếu để xử lý xác thực Let's Encrypt và chuyển hướng sang HTTPS
# Certbot thường tự động tạo/quản lý block này
server {
    listen 80;
    listen [::]:80; # Cho IPv6 nếu có

    server_name confhub.ddns.net; # Tên miền của bạn

    # Xử lý yêu cầu xác thực của Let's Encrypt (Certbot cần cái này)
    location /.well-known/acme-challenge/ {
        # Đảm bảo thư mục này tồn tại và Nginx có quyền đọc/ghi
        root /var/www/html;
        allow all; # Cho phép tất cả truy cập vào đây
    }

    # Chuyển hướng tất cả các yêu cầu HTTP khác sang HTTPS
    location / {
        # Return 301 là chuyển hướng vĩnh viễn, tốt cho SEO
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