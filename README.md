### **Hướng Dẫn Triển Khai Toàn Diện Hệ Thống trên VPS Ubuntu**

**Mục tiêu:** Triển khai 3 ứng dụng (Server Backend, Frontend Client, Frontend Admin) trên một VPS Linux Ubuntu, sử dụng Nginx làm Reverse Proxy và bảo mật bằng HTTPS của Let's Encrypt. Các ứng dụng sẽ được quản lý dưới dạng service bằng `systemd` để đảm bảo chúng tự động chạy và khởi động lại khi cần.

**Điều kiện tiên quyết:**
1.  Một VPS chạy hệ điều hành Ubuntu (ví dụ: 20.04, 22.04).
2.  Quyền truy cập `sudo`.
3.  Một tên miền đã trỏ về địa chỉ IP của VPS (ví dụ: `confhub.ddns.net`).

---

### **Phần 1: Chuẩn Bị Môi Trường Server**

Đây là bước thiết lập nền tảng, cài đặt các phần mềm cần thiết để ứng dụng có thể chạy.

#### **Bước 1.1: Cập nhật hệ thống và cài đặt các công cụ cơ bản**

Luôn bắt đầu bằng việc cập nhật danh sách gói phần mềm và nâng cấp các gói đã cài đặt lên phiên bản mới nhất.

```bash
# Cập nhật danh sách gói phần mềm từ các kho lưu trữ
sudo apt update

# Nâng cấp các gói đã cài đặt lên phiên bản mới nhất
sudo apt upgrade -y

# Cài đặt các công cụ cần thiết: curl (để tải file), git (để lấy code), nginx (web server)
sudo apt install curl git nginx -y
```
*   **Giải thích:**
    *   `apt update`: Đồng bộ hóa danh sách gói phần mềm trên máy của bạn với các kho lưu trữ.
    *   `apt upgrade -y`: Tự động nâng cấp tất cả các gói có thể nâng cấp mà không cần hỏi.
    *   `curl`, `git`, `nginx`: Cài đặt các công cụ nền tảng mà chúng ta sẽ sử dụng trong suốt quá trình.

#### **Bước 1.2: Cài đặt Node.js**

Ứng dụng của chúng ta được xây dựng bằng Node.js, nhưng phiên bản trong kho mặc định của Ubuntu thường cũ. Chúng ta sẽ sử dụng kho của NodeSource để cài đặt phiên bản mới (v20.x).

```bash
# Tải và thực thi script cài đặt kho lưu trữ NodeSource v20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Cài đặt Node.js từ kho lưu trữ vừa thêm
sudo apt install -y nodejs
```
*   **Giải thích:**
    *   Dòng lệnh `curl ...`: Tải về một script từ NodeSource và thực thi nó với quyền `sudo`. Script này sẽ tự động thêm kho lưu trữ chính thức của Node.js vào hệ thống của bạn.
    *   `sudo apt install -y nodejs`: Cài đặt Node.js. Vì chúng ta đã thêm kho của NodeSource, lệnh này sẽ cài đặt phiên bản v20.x.

#### **Bước 1.3: Cài đặt Microsoft Edge (Dependency cho Playwright)**

Hệ thống Crawl sử dụng Playwright, và Playwright cần một trình duyệt để hoạt động. Chúng ta sẽ cài đặt Microsoft Edge theo yêu cầu của hệ thống.

```bash
# Tải khóa GPG của Microsoft và thêm vào danh sách các khóa tin cậy
curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
sudo install -o root -g root -m 644 microsoft.gpg /etc/apt/trusted.gpg.d/

# Thêm kho lưu trữ của Microsoft Edge vào hệ thống
sudo sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/edge stable main" > /etc/apt/sources.list.d/microsoft-edge-dev.list'

# Xóa file GPG đã tải về
rm microsoft.gpg

# Cập nhật lại danh sách gói để nhận diện kho lưu trữ mới
sudo apt update

# Cài đặt Microsoft Edge phiên bản ổn định
sudo apt install microsoft-edge-stable -y
```
*   **Giải thích:** Các bước này tuân theo quy trình chuẩn để thêm một kho lưu trữ phần mềm của bên thứ ba vào Ubuntu: thêm khóa xác thực, thêm địa chỉ kho, cập nhật và cài đặt.

---

### **Phần 2: Triển Khai Mã Nguồn và Cấu Hình**

Bây giờ chúng ta sẽ lấy mã nguồn từ Git về server và cấu hình môi trường cho từng ứng dụng.

#### **Bước 2.1: Tải mã nguồn từ Git**

Giả sử bạn đang ở trong thư mục home của user (ví dụ: `/home/admin_leloi`).

```bash
# Tải mã nguồn của Server Backend
git clone <URL_REPO_SERVER-TS> SERVER-TS

# Tải mã nguồn của Frontend Client
git clone <URL_REPO_FE_CLIENT> confhub2-fe-client-side

# Tải mã nguồn của Frontend Admin
git clone <URL_REPO_FE_ADMIN> confhub2-fe-admin-side
```
*   **Lưu ý:** Thay `<URL_REPO_...>` bằng URL Git repository thực tế của bạn.

#### **Bước 2.2: Cài đặt Dependencies và Cấu hình Biến Môi Trường**

Đây là bước cực kỳ quan trọng. Mỗi ứng dụng cần cài đặt các thư viện của nó và một file `.env` để chứa các cấu hình nhạy cảm.

**Đối với Server Backend (`SERVER-TS`):**
```bash
# Di chuyển vào thư mục dự án
cd SERVER-TS

# Cài đặt các thư viện từ package.json
npm install

# Tạo file .env từ file ví dụ
cp .env.example .env

# Mở và chỉnh sửa file .env
nano .env
```
Trong file `.env`, bạn cần điền các giá trị thực tế, ví dụ:
`DATABASE_URL="postgresql://user:password@host:port/database"`
`GEMINI_API_KEY="your_gemini_api_key"`
`JWT_SECRET="your_strong_jwt_secret"`
`...`

**Đối với Frontend Client (`confhub2-fe-client-side`):**
```bash
# Quay lại thư mục home và vào dự án client
cd ../confhub2-fe-client-side

# Cài đặt các thư viện
npm install

# Tạo và chỉnh sửa file .env.local
cp .env.example .env.local
nano .env.local
```
Trong file `.env.local`, bạn cần cấu hình URL của backend:
`NEXT_PUBLIC_API_URL="https://confhub.ddns.net/api"`
`NEXT_PUBLIC_SOCKET_URL="https://confhub.ddns.net"`
`...`

**Đối với Frontend Admin (`confhub2-fe-admin-side`):**
```bash
# Quay lại thư mục home và vào dự án admin
cd ../confhub2-fe-admin-side

# Cài đặt các thư viện
npm install

# Tạo và chỉnh sửa file .env.local
cp .env.example .env.local
nano .env.local
```
Tương tự, cấu hình URL backend trong file `.env.local`.

#### **Bước 2.3: Build ứng dụng cho môi trường Production**

Chúng ta không chạy ứng dụng ở chế độ `dev`. Chúng ta cần build phiên bản tối ưu hóa cho production.

```bash
# Build Frontend Client
cd ../confhub2-fe-client-side
npm run build

# Build Frontend Admin
cd ../confhub2-fe-admin-side
npm run build

# Build Server Backend (nếu cần, thường là biên dịch TypeScript)
cd ../SERVER-TS
npm run build
```
*   **Giải thích:** Lệnh `npm run build` sẽ tạo ra một thư mục (thường là `.next` cho Next.js và `dist` cho server TS) chứa code đã được tối ưu hóa, sẵn sàng để chạy trên môi trường production.

---

### **Phần 3: Quản lý Ứng Dụng bằng Systemd**

`systemd` là trình quản lý hệ thống và dịch vụ của Linux. Chúng ta sẽ tạo các file service để `systemd` có thể quản lý (khởi động, khởi động lại, theo dõi) các ứng dụng của chúng ta.

**Quan trọng:** Các file service dưới đây đã được sửa lại để chạy ở chế độ **production** (`npm start`), không phải `npm run dev`.

#### **Bước 3.1: Tạo file Service cho Frontend Client**
```bash
sudo nano /etc/systemd/system/client.service
```
Dán nội dung sau vào file (thay `admin_leloi` bằng user của bạn):
```ini
[Unit]
Description=ConfHub Client Frontend
After=network.target

[Service]
Type=simple
User=admin_leloi
WorkingDirectory=/home/admin_leloi/confhub2-fe-client-side
# Chạy ứng dụng Next.js đã build trên cổng 8386
ExecStart=/usr/bin/npm start -- -p 8386
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

#### **Bước 3.2: Tạo file Service cho Frontend Admin**
```bash
sudo nano /etc/systemd/system/admin.service
```
Dán nội dung sau vào file:
```ini
[Unit]
Description=ConfHub Admin Frontend
After=network.target

[Service]
Type=simple
User=admin_leloi
WorkingDirectory=/home/admin_leloi/confhub2-fe-admin-side
# Chạy ứng dụng Next.js đã build trên cổng 1314
ExecStart=/usr/bin/npm start -- -p 1314
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

#### **Bước 3.3: Tạo file Service cho Server Backend**
```bash
sudo nano /etc/systemd/system/server.service
```
Dán nội dung sau vào file:
```ini
[Unit]
Description=ConfHub Backend Server
After=network.target

[Service]
Type=simple
User=admin_leloi
WorkingDirectory=/home/admin_leloi/SERVER-TS
# Chạy ứng dụng backend đã build (giả sử cổng 3001)
ExecStart=/usr/bin/npm start
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
*   **Giải thích các thuộc tính trong file `.service`:**
    *   `Description`: Mô tả về service.
    *   `After=network.target`: Service này chỉ nên khởi động sau khi mạng đã sẵn sàng.
    *   `User`: Chạy service dưới quyền của user này (an toàn hơn là chạy bằng `root`).
    *   `WorkingDirectory`: Thư mục làm việc của ứng dụng.
    *   `ExecStart`: Lệnh thực thi để khởi động ứng dụng. `npm start` sẽ chạy script `start` trong `package.json`, thường là `node dist/main.js` hoặc tương tự cho production.
    *   `Restart=on-failure`: Tự động khởi động lại service nếu nó bị lỗi.
    *   `Environment=NODE_ENV=production`: Đặt biến môi trường, rất quan trọng để ứng dụng chạy ở chế độ tối ưu.
    *   `WantedBy=multi-user.target`: Cho phép service khởi động cùng hệ thống.

#### **Bước 3.4: Quản lý các Service**

Sau khi tạo các file `.service`, chúng ta cần ra lệnh cho `systemd` để nhận diện và quản lý chúng.

```bash
# Tải lại cấu hình của systemd để nhận diện các file service mới
sudo systemctl daemon-reload

# Kích hoạt các service để chúng tự động khởi động cùng hệ thống
sudo systemctl enable client.service
sudo systemctl enable admin.service
sudo systemctl enable server.service

# Khởi động các service ngay lập tức
sudo systemctl start client.service
sudo systemctl start admin.service
sudo systemctl start server.service

# (Tùy chọn) Kiểm tra trạng thái của các service
sudo systemctl status client.service admin.service server.service
```

---

### **Phần 4: Cấu hình Nginx làm Reverse Proxy và Bảo mật HTTPS**

Hiện tại, các ứng dụng đang chạy trên các cổng nội bộ (`8386`, `1314`, `3001`). Chúng ta sẽ dùng Nginx làm "người gác cổng", nhận tất cả truy cập từ bên ngoài qua cổng 80 (HTTP) và 443 (HTTPS) và điều hướng chúng đến đúng ứng dụng.

#### **Bước 4.1: Cấu hình Firewall**
Đảm bảo tường lửa cho phép truy cập Nginx.
```bash
# Cho phép Nginx truy cập qua cả cổng 80 và 443
sudo ufw allow 'Nginx Full'

# Tải lại cấu hình tường lửa
sudo ufw reload
```

#### **Bước 4.2: Tạo file Cấu hình Nginx**
```bash
sudo nano /etc/nginx/sites-available/default
```
Dán toàn bộ nội dung sau vào file. Cấu hình này đã được chú thích chi tiết.

```nginx
# --- Cấu hình cho SERVER BACKEND, CLIENT và ADMIN ---
# /etc/nginx/sites-available/default
# Đây là đường dẫn và tên của file cấu hình Nginx.
# File này thường được đặt trong thư mục 'sites-available' và sau đó được liên kết (symlink)
# sang thư mục 'sites-enabled' để Nginx nhận diện và sử dụng.

# --- Cấu hình cho Backend API (Proxy) và Frontend ---
# Dòng chú thích này chỉ rõ rằng khối server tiếp theo sẽ cấu hình cả việc proxy cho API backend và các frontend.

server {
    # Khai báo một khối 'server' mới, đại diện cho một virtual host hoặc một ứng dụng web cụ thể.

    # --- Phần HTTPS (Cổng 443) ---
    # Dòng chú thích này chỉ rõ đây là phần cấu hình cho giao thức HTTPS.
    listen 443 ssl http2;
    # Lắng nghe các kết nối đến trên cổng 443 (cổng mặc định cho HTTPS).
    # 'ssl' bật tính năng SSL/TLS cho kết nối này.
    # 'http2' kích hoạt giao thức HTTP/2, giúp cải thiện hiệu suất tải trang.

    listen [::]:443 ssl http2;
    # Tương tự như trên, nhưng lắng nghe trên tất cả các địa chỉ IPv6 trên cổng 443.

    server_name confhub.ddns.net;
    # Xác định tên miền mà server block này sẽ phản hồi.
    # Khi một yêu cầu HTTP/S đến với Host header là 'confhub.ddns.net', Nginx sẽ sử dụng cấu hình này.

    # --- Cấu hình SSL (Do Certbot quản lý) ---
    # Dòng chú thích này cho biết các dòng tiếp theo là cấu hình SSL và thường được quản lý bởi Certbot.
    ssl_certificate /etc/letsencrypt/live/confhub.ddns.net/fullchain.pem;
    # Chỉ định đường dẫn đến file chứng chỉ SSL (public key) cho tên miền này.
    # 'fullchain.pem' chứa chứng chỉ của bạn và các chứng chỉ trung gian cần thiết.
    ssl_certificate_key /etc/letsencrypt/live/confhub.ddns.net/privkey.pem;
    # Chỉ định đường dẫn đến file khóa riêng (private key) tương ứng với chứng chỉ.
    # File này phải được bảo vệ chặt chẽ.
    include /etc/letsencrypt/options-ssl-nginx.conf;
    # Bao gồm một file cấu hình SSL tiêu chuẩn được tạo bởi Certbot.
    # File này chứa các cài đặt bảo mật SSL được khuyến nghị (ví dụ: ciphers, protocols).
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    # Chỉ định đường dẫn đến file tham số Diffie-Hellman, được sử dụng để tăng cường bảo mật cho trao đổi khóa SSL.
    # Thường được tạo thủ công hoặc bởi Certbot.

    # --- Proxy cho Backend API (Qua /api/) ---
    # Dòng chú thích này chỉ rõ đây là phần cấu hình proxy cho API backend.
    # Block này PHẢI đứng TRƯỚC các location frontend
    # Nginx xử lý các 'location' theo thứ tự ưu tiên:
    # 1. Các location khớp chính xác (exact match)
    # 2. Các location tiền tố dài nhất (longest prefix match)
    # 3. Các location sử dụng biểu thức chính quy (regex)
    # Đặt '/api/' trước '/' đảm bảo rằng các yêu cầu đến '/api/' sẽ được xử lý bởi block này trước khi rơi vào block tổng quát '/'.
    location /api/ {
    # Bắt đầu một khối 'location' mà sẽ xử lý các yêu cầu có URL bắt đầu bằng '/api/'.
    rewrite ^/api/(.*)$ /$1 break;
    # Một quy tắc rewrite (viết lại URL).
    # ^/api/(.*)$: khớp với bất kỳ URL nào bắt đầu bằng '/api/' và "bắt" phần còn lại của URL vào nhóm 1 (($1)).
    # /$1: thay thế URL bằng phần đã "bắt" được (ví dụ: '/api/users' thành '/users').
    # break: ngừng xử lý các quy tắc rewrite tiếp theo trong cùng khối 'location' và tiếp tục xử lý các directive khác.
    # Mục đích là để backend API không cần biết về tiền tố '/api/'.
    proxy_pass http://localhost:3001/;
    # Chuyển tiếp (proxy) yêu cầu đến địa chỉ HTTP://localhost:3001/. Đây là địa chỉ của backend API.
    # Dấu '/' ở cuối 'http://localhost:3001/' là quan trọng: nó sẽ thay thế phần khớp của URI (sau khi rewrite) bằng URI mới.
    # Ví dụ: yêu cầu tới `/api/users` sẽ được rewrite thành `/users` và sau đó proxy tới `http://localhost:3001/users`.
    proxy_set_header Host $host;
    # Gửi Host header ban đầu của client đến backend. Điều này quan trọng cho các ứng dụng backend dựa trên Host.
    proxy_set_header X-Real-IP $remote_addr;
    # Gửi địa chỉ IP thực của client đến backend. Hữu ích cho việc ghi log và bảo mật.
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # Gửi danh sách các địa chỉ IP đã qua proxy. Nginx thêm IP của nó vào danh sách.
    proxy_set_header X-Forwarded-Proto $scheme;
    # Gửi giao thức ban đầu của yêu cầu (http hoặc https) đến backend.
    proxy_http_version 1.1;
    # Sử dụng HTTP/1.1 cho kết nối từ Nginx đến backend. Cần thiết cho WebSocket.
    proxy_set_header Upgrade $http_upgrade;
    # Chuyển tiếp Upgrade header nếu có (cho WebSocket).
    proxy_set_header Connection "upgrade";
    # Chuyển tiếp Connection header với giá trị "upgrade" (cho WebSocket).

    # Tăng thời gian chờ phản hồi từ backend
    # Dòng chú thích này giải thích mục đích của các cài đặt timeout tiếp theo.
    # Giá trị này nên đủ lớn để backend xử lý một batch
    # Ví dụ: 10 phút (600 giây). Điều chỉnh nếu cần.
    # Nếu một batch 50 items có thể mất nhiều hơn, hãy tăng thêm.
    # Frontend của bạn đang đặt timeout axios là 2 giờ (7200000ms),
    # nhưng không nên đặt Nginx timeout quá cao như vậy.
    # Hãy ước lượng thời gian tối đa cho 1 batch.
    proxy_connect_timeout 600s;
    # Thời gian tối đa Nginx chờ thiết lập kết nối đến backend (600 giây = 10 phút).
    proxy_send_timeout 600s;
    # Thời gian tối đa Nginx chờ gửi dữ liệu (request body) đến backend (600 giây).
    proxy_read_timeout 600s; # Quan trọng nhất
    # Thời gian tối đa Nginx chờ đọc phản hồi từ backend (600 giây).
    # Nếu backend không gửi bất kỳ dữ liệu nào trong khoảng thời gian này, Nginx sẽ đóng kết nối và trả về lỗi 504 Gateway Timeout.

    # Cân nhắc thêm nếu payload request lớn (dù không phải nguyên nhân 504)
    # Dòng chú thích này gợi ý về việc cân nhắc cài đặt kích thước body request.
    # client_max_body_size 50M; # Ví dụ: cho phép payload lên tới 50MB
    # Directive này bị comment (không hoạt động). Nếu muốn giới hạn kích thước body của request từ client đến Nginx,
    # có thể bỏ comment và đặt giá trị phù hợp (ví dụ: 50 megabytes).
    # Điều này ngăn chặn các cuộc tấn công DoS hoặc xử lý các yêu cầu quá lớn.
    }

    # --- Proxy cho Frontend ADMIN (Qua /admin/) ---
    # Dòng chú thích này chỉ rõ đây là phần cấu hình proxy cho frontend admin.
    # Block này sẽ xử lý các yêu cầu tới confhub.ddns.net/admin/
    # Nó PHẢI đứng TRƯỚC 'location /' (cho client frontend)
    # Giải thích tương tự như với '/api/', đảm bảo ưu tiên cho đường dẫn cụ thể.
    location /admin/ {
    # Bắt đầu một khối 'location' mà sẽ xử lý các yêu cầu có URL bắt đầu bằng '/admin/'.

        # Địa chỉ frontend admin của bạn
        proxy_pass http://localhost:1314;
        # Chuyển tiếp (proxy) yêu cầu đến địa chỉ HTTP://localhost:1314/, nơi frontend admin đang chạy.

        # Các header quan trọng
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Các cài đặt header tương tự như với proxy backend API, đảm bảo thông tin client được chuyển tiếp chính xác.

        # Hỗ trợ WebSocket
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # Các cài đặt này cần thiết để hỗ trợ WebSocket, nếu frontend admin có sử dụng.
    }
    
    # --- Proxy cho Frontend CLIENT (Next.js) ---
    # Dòng chú thích này chỉ rõ đây là phần cấu hình proxy cho frontend client chính.
    # Block này xử lý tất cả các yêu cầu còn lại không khớp với /api/ hoặc /admin/
    # Vì đây là 'location /', nó sẽ là khối mặc định xử lý bất kỳ yêu cầu nào không khớp với các location cụ thể hơn trước đó.
    location / {
    # Bắt đầu một khối 'location' xử lý tất cả các yêu cầu (mặc định) không khớp với các location cụ thể hơn.

        # Địa chỉ frontend client của bạn
        proxy_pass http://localhost:8386;
        # Chuyển tiếp (proxy) yêu cầu đến địa chỉ HTTP://localhost:8386/, nơi frontend client (Next.js) đang chạy.

        # Các header quan trọng
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Các cài đặt header tương tự như trên.

        # Hỗ trợ WebSocket
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # Các cài đặt này cần thiết để hỗ trợ WebSocket, nếu frontend client có sử dụng.
    }

    # Optional: Cấu hình thêm
    # Dòng chú thích cho các cấu hình bổ sung tùy chọn.
    # access_log /var/log/nginx/confhub.ddns.net.access.log;
    # Bị comment. Nếu bỏ comment, Nginx sẽ ghi lại tất cả các yêu cầu truy cập vào file log này.
    # error_log /var/log/nginx/confhub.ddns.net.error.log;
    # Bị comment. Nếu bỏ comment, Nginx sẽ ghi lại các lỗi vào file log này.
    client_max_body_size 50M;
    # Đặt kích thước tối đa cho body của request từ client đến Nginx là 50 megabytes.
    # Nếu một client gửi một request có body lớn hơn giới hạn này, Nginx sẽ trả về lỗi 413 Request Entity Too Large.
    # Điều này áp dụng cho toàn bộ server block này.
}

# --- Phần HTTP (Cổng 80) ---
# Dòng chú thích chỉ rõ đây là phần cấu hình cho giao thức HTTP.
# Không cần thay đổi gì ở đây
# Dòng này gợi ý rằng cấu hình này thường không cần chỉnh sửa vì mục đích chính của nó là chuyển hướng sang HTTPS và hỗ trợ Certbot.
server {
    # Khai báo một khối 'server' mới cho các kết nối HTTP.
    listen 80;
    # Lắng nghe các kết nối đến trên cổng 80 (cổng mặc định cho HTTP).
    listen [::]:80;
    # Tương tự như trên, nhưng lắng nghe trên tất cả các địa chỉ IPv6 trên cổng 80.

    server_name confhub.ddns.net;
    # Xác định tên miền mà server block này sẽ phản hồi.

    location /.well-known/acme-challenge/ {
    # Bắt đầu một khối 'location' đặc biệt dành cho các yêu cầu xác thực của Certbot (ACME challenge).
        root /var/www/html;
        # Chỉ định thư mục gốc mà Nginx sẽ tìm kiếm các file xác thực.
        allow all;
        # Cho phép tất cả các IP truy cập vào đường dẫn này (cần thiết cho Certbot để xác minh).
    }

    location / {
    # Bắt đầu một khối 'location' mặc định cho tất cả các yêu cầu còn lại trên cổng 80.
        return 301 https://$host$request_uri;
        # Trả về một mã trạng thái 301 Moved Permanently.
        # $host: tên miền được yêu cầu (ví dụ: confhub.ddns.net).
        # $request_uri: đường dẫn đầy đủ của yêu cầu (ví dụ: /api/users?id=1).
        # Kết quả là: tất cả các yêu cầu HTTP đến sẽ được tự động chuyển hướng vĩnh viễn sang phiên bản HTTPS tương ứng.
    }
}
```

#### **Bước 4.3: Kích hoạt Cấu hình Nginx**
```bash
# Tạo một liên kết tượng trưng từ sites-available sang sites-enabled
sudo ln -s /etc/nginx/sites-available/confhub.ddns.net /etc/nginx/sites-enabled/

# Kiểm tra cú pháp file cấu hình Nginx xem có lỗi không
sudo nginx -t

# Nếu không có lỗi, tải lại Nginx để áp dụng cấu hình
sudo systemctl reload nginx
```

#### **Bước 4.4: Cài đặt Certbot và Lấy Chứng chỉ SSL**
Chúng ta sẽ dùng `snap` để cài đặt Certbot, đây là cách được khuyến nghị.
```bash
# Cài đặt snapd nếu chưa có
sudo apt install snapd -y

# Cài đặt Certbot core
sudo snap install core; sudo snap refresh core

# Gỡ bỏ certbot cũ nếu có
sudo apt-get remove certbot

# Cài đặt Certbot và tạo liên kết để có thể dùng lệnh `certbot`
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```
Bây giờ, hãy chạy Certbot để tự động lấy chứng chỉ và cấu hình Nginx:
```bash
# Chạy Certbot cho tên miền của bạn, sử dụng plugin Nginx
sudo certbot --nginx -d confhub.ddns.net
```
*   Certbot sẽ hỏi bạn một vài câu hỏi (email, đồng ý điều khoản).
*   Nó sẽ tự động phát hiện cấu hình Nginx của bạn, lấy chứng chỉ và **sửa đổi file `/etc/nginx/sites-available/confhub.ddns.net`** để bật SSL.
*   Nó cũng sẽ tự động thiết lập việc gia hạn chứng chỉ.

---

### **Phần 5: Kiểm Tra và Gỡ Lỗi**

Hệ thống của bạn giờ đã hoạt động!

1.  **Truy cập:** Mở trình duyệt và truy cập:
    *   `https://confhub.ddns.net` (để vào trang Client)
    *   `https://confhub.ddns.net/admin` (để vào trang Admin)
2.  **Kiểm tra trạng thái Service:**
    ```bash
    sudo systemctl status client.service admin.service server.service
    ```
3.  **Xem Log trực tiếp (quan trọng nhất khi gỡ lỗi):**
    ```bash
    # Xem log của server backend
    sudo journalctl -u server.service -f

    # Xem log của frontend client
    sudo journalctl -u client.service -f

    # Xem log của frontend admin
    sudo journalctl -u admin.service -f
    ```
    *   **Mẹo:** Dùng `sudo journalctl -u server.service -n 200` để xem 200 dòng log cuối cùng.

Chúc mừng! Bạn đã triển khai thành công toàn bộ hệ thống trên VPS.