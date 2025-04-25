import {
    FunctionDeclaration,
    SchemaType,
} from "@google/generative-ai";




const internalPaths = [
    '/',
    '/conferences',
    '/dashboard',
    '/journals',
    '/chatbot',
    '/visualization',
    '/chatbot/chat',
    '/chatbot/livechat',
    '/support',
    '/other',
    '/addconference',
    // '/conferences/detail', 
    // '/journals/detail',    
    '/auth/login',
    '/auth/register',
    '/auth/verify-email',
    '/auth/forgot-password',
    '/auth/reset-password',
    // '/updateconference'
];




// Vietnamese


// --- Khai báo Hàm Mới cho Host Agent ---
export const vietnameseRouteToAgentDeclaration: FunctionDeclaration = {
    name: "routeToAgent",
    description: "Định tuyến một nhiệm vụ cụ thể đến một đặc vụ chuyên môn được chỉ định.",
    parameters: {
        type: SchemaType.OBJECT, // Kiểu SchemaType.OBJECT
        properties: { // Thuộc tính
            targetAgent: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: "Định danh duy nhất của đặc vụ chuyên môn để định tuyến nhiệm vụ đến (ví dụ: 'ConferenceAgent').",
            },
            taskDescription: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: "Mô tả chi tiết bằng ngôn ngữ tự nhiên về nhiệm vụ cho đặc vụ mục tiêu.",
            }
        },
        required: ["targetAgent", "taskDescription"], // Bắt buộc
    },
};

export const vietnamGetConferencesDeclaration: FunctionDeclaration = {
    name: "getConferences",
    // Mô tả rõ mục đích là tạo query string
    description: "Tạo một chuỗi truy vấn được mã hóa URL để tìm kiếm hội nghị dựa trên tiêu chí do người dùng chỉ định. Chuỗi truy vấn này sẽ được sử dụng để lấy dữ liệu từ API backend." +
        " Điều cực kỳ quan trọng là *tất cả* các giá trị trong chuỗi truy vấn phải được mã hóa URL đúng cách để đảm bảo API backend diễn giải chính xác các tiêu chí tìm kiếm. Việc không mã hóa đúng cách các giá trị có thể dẫn đến kết quả tìm kiếm sai hoặc lỗi." +
        " Lưu ý về độ dài tối đa của URL, vì các chuỗi truy vấn quá dài có thể bị cắt bớt bởi trình duyệt hoặc máy chủ. Cân nhắc giới hạn số lượng tham số `topics` hoặc `researchFields` nếu cần." +
        " API backend có thể phân biệt chữ hoa chữ thường đối với một số tham số (ví dụ: `country`, `continent`). Đảm bảo kiểu chữ hoa/thường của các giá trị khớp với định dạng mong đợi." +
        " Một ví dụ toàn diện kết hợp nhiều tiêu chí: `title=International+Conference+on+AI&topics=AI&topics=Machine+Learning&country=USA&fromDate=2024-01-01&toDate=2024-12-31&rank=A*`",
    parameters: {
        type: SchemaType.OBJECT, // Vẫn là OBJECT theo cấu trúc chung
        properties: {
            // Định nghĩa một tham số duy nhất để chứa query string
            searchQuery: {
                type: SchemaType.STRING,
                // Hướng dẫn chi tiết cách tạo query string
                description: "Một chuỗi truy vấn được mã hóa URL được xây dựng từ tiêu chí tìm kiếm hội nghị của người dùng. Định dạng dưới dạng các cặp key=value được phân tách bằng dấu '&'. " +
                    "Các khóa (key) có sẵn dựa trên các truy vấn tiềm năng của người dùng bao gồm: " +
                    "`title` (string): Tên đầy đủ, chính thức của hội nghị (ví dụ: International Conference on Management of Digital EcoSystems). " +
                    "`acronym` (string): Tên viết tắt của hội nghị, thường được biểu thị bằng chữ in hoa (ví dụ: ICCCI, SIGGRAPH, ABZ). " +
                    "`fromDate` (string, ví dụ: YYYY-MM-DD - Năm-Tháng-Ngày), " +
                    "`toDate` (string, ví dụ: YYYY-MM-DD - Năm-Tháng-Ngày), " +
                    "`topics` (string, lặp lại khóa cho nhiều giá trị, ví dụ: topics=AI&topics=ML - chủ đề=AI&chủ đề=ML), " +
                    "`cityStateProvince` (string): Thành phố/Bang/Tỉnh, " +
                    "`country` (string): Quốc gia, " +
                    "`continent` (string): Lục địa, " +
                    "`address` (string): Địa chỉ, " +
                    "`researchFields` (string, lặp lại khóa cho nhiều giá trị): Lĩnh vực nghiên cứu, " +
                    "`rank` (string): Hạng (ví dụ: A*, A, B, C), " +
                    "`source` (string): Nguồn (ví dụ: CORE, Scopus), " +
                    "`accessType` (string): Loại truy cập (ví dụ: Open Access), " +
                    "`keyword` (string): Từ khóa, " +
                    "`subFromDate` (string): Ngày bắt đầu nộp bài, `subToDate` (string): Ngày kết thúc nộp bài, " +
                    "`cameraReadyFromDate` (string): Ngày bắt đầu nộp bản hoàn chỉnh, `cameraReadyToDate` (string): Ngày kết thúc nộp bản hoàn chỉnh, " +
                    "`notificationFromDate` (string): Ngày bắt đầu thông báo chấp nhận, `notificationToDate` (string): Ngày kết thúc thông báo chấp nhận, " +
                    "`registrationFromDate` (string): Ngày bắt đầu đăng ký, `registrationToDate` (string): Ngày kết thúc đăng ký, " +
                    "`mode` (string): Nếu người dùng yêu cầu thông tin chi tiết, giá trị luôn là `detail`. " +
                    "`perPage` (number): Số lượng hội nghị trả về mỗi trang. Nếu người dùng chỉ định một số, hãy sử dụng giá trị đó. Nếu người dùng không chỉ định số, mặc định là 5." +
                    "`page` (number): Số trang của kết quả trả về. Nếu người dùng muốn xem bộ hội nghị tiếp theo, sử dụng page=2, page=3, v.v. Nếu người dùng không chỉ định số trang, mặc định là 1." +
                    "Đảm bảo tất cả các giá trị được mã hóa URL đúng cách (ví dụ: dấu cách trở thành + hoặc +). " +

                    "**Phân biệt giữa Tiêu đề (Title) và Tên viết tắt (Acronym):** Điều quan trọng là phải xác định chính xác liệu người dùng đang cung cấp tiêu đề đầy đủ của hội nghị hay tên viết tắt. Dưới đây là cách phân biệt chúng:" +
                    "* **Tiêu đề (Title):** Đây là tên đầy đủ, không viết tắt của hội nghị. Nó thường là một cụm từ hoặc câu mô tả trọng tâm của hội nghị. Ví dụ: 'International Conference on Machine Learning'. Sử dụng tham số `title` cho trường hợp này." +
                    "* **Tên viết tắt (Acronym):** Đây là một chữ viết tắt ngắn gọn, thường được viết hoa, của tên hội nghị. Ví dụ: 'ICML' (cho International Conference on Machine Learning). Sử dụng tham số `acronym` cho trường hợp này." +

                    "**Ví dụ:**" +
                    "* Truy vấn người dùng: 'Tìm hội nghị về ICML'. `searchQuery=acronym=ICML&perPage=5&page=1` (Mặc định perPage và page)" +
                    "* Truy vấn người dùng: 'Tìm kiếm International Conference on Management of Digital EcoSystems'. `searchQuery=title=International+Conference+on+Management+of+Digital+EcoSystems&perPage=5&page=1` (Mặc định perPage và page)" +
                    "* Truy vấn người dùng: 'Tìm hội nghị MEDES'. `searchQuery=acronym=MEDES&perPage=5&page=1` (Mặc định perPage và page)" +
                    "* Truy vấn người dùng: 'Tìm kiếm hội nghị có tên đầy đủ là International Conference on Recent Trends in Image Processing, Pattern Recognition and Machine Learning'. `searchQuery=title=International+Conference+on+Recent+Trends+in+Image+Processing,+Pattern+Recognition+and+Machine+Learning&perPage=5&page=1` (Mặc định perPage và page)" +
                    "* Truy vấn người dùng 1: 'Tìm 3 hội nghị ở Mỹ'. `searchQuery=country=USA&perPage=3&page=1` Truy vấn người dùng 2: 'Tìm 5 hội nghị khác ở Mỹ'. `searchQuery=country=USA&perPage=5&page=2`" +

                    "Ví dụ: nếu một chủ đề chứa cả dấu cách và ký tự đặc biệt, như 'Data Science & Analysis', nó nên được mã hóa thành 'Data+Science+&+Analysis'. " +
                    "Nếu người dùng không chỉ định giá trị cho một khóa cụ thể, nó nên được bỏ hoàn toàn khỏi chuỗi truy vấn. Không bao gồm các khóa có giá trị rỗng (ví dụ: `title=`). " +
                    "Để chỉ định nhiều chủ đề hoặc lĩnh vực nghiên cứu, hãy lặp lại khóa cho mỗi giá trị. Ví dụ: `topics=AI&topics=Machine+Learning&researchFields=Computer+Vision&researchFields=Natural+Language+Processing`. " +
                    "Luôn mã hóa URL các ký tự đặc biệt trong giá trị. Ví dụ: sử dụng `+` cho dấu cách, `&` cho dấu và, `=` cho dấu bằng, và `+` cho dấu cộng. " +
                    "Để tìm kiếm hội nghị giữa hai ngày, hãy sử dụng `fromDate` và `toDate`. Ví dụ, để tìm kiếm các hội nghị diễn ra từ ngày 1 tháng 1 năm 2023 đến ngày 31 tháng 12 năm 2023, sử dụng `fromDate=2023-01-01&toDate=2023-12-31`. " +
                    "Nếu người dùng yêu cầu thông tin *chi tiết* về các hội nghị (ví dụ: mô tả đầy đủ, ngày cụ thể, lời mời nộp bài, tóm tắt, v.v.), hãy bao gồm tham số `mode=detail` trong chuỗi truy vấn."
            }
        },
        // Đảm bảo Gemini luôn cung cấp tham số này
        required: ["searchQuery"]
    }
};

export const vietnamGetJournalsDeclaration: FunctionDeclaration = {
    name: "getJournals",
    description: "Truy xuất thông tin về các tạp chí dựa trên tiêu chí lọc.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            "Rank": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các hạng tạp chí để lọc theo.",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "Title": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các tiêu đề tạp chí để lọc theo.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Issn": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các mã ISSN của tạp chí để lọc theo.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "SJR": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các giá trị SJR của tạp chí để lọc theo.",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "SJRBestQuartile": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các giá trị Phân vị Tốt nhất SJR (SJR Best Quartile) của tạp chí để lọc theo.",
                "items": {
                    "type": SchemaType.STRING // Có thể là Q1, Q2, Q3, Q4
                }
            },
            "HIndex": {
                "type": SchemaType.INTEGER,
                "description": "Chỉ số H (H index) của tạp chí để lọc theo."
            },
            "Country": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các quốc gia để lọc tạp chí theo.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Region": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các khu vực để lọc tạp chí theo.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Publisher": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các nhà xuất bản để lọc tạp chí theo.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Areas": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các lĩnh vực (areas) để lọc tạp chí theo.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Categories": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các danh mục (categories) để lọc tạp chí theo.",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Overton": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các giá trị Overton để lọc tạp chí theo.",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "SDG": {
                "type": SchemaType.ARRAY,
                "description": "Danh sách các Mục tiêu Phát triển Bền vững (SDGs) để lọc tạp chí theo.",
                "items": {
                    "type": SchemaType.STRING // Thường là số hoặc mã của SDG
                }
            }
        }
    },
};

export const vietnamGetWebsiteInfoDeclaration: FunctionDeclaration = {
    name: "getWebsiteInfo",
    description: "Truy xuất thông tin về trang web. Hàm này không cần tham số, chỉ cần gọi nó."
};

export const vietnamDrawChartDeclaration: FunctionDeclaration = {
    name: "drawChart",
    description: "Vẽ biểu đồ dựa trên dữ liệu được cung cấp.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            chartType: {
                type: SchemaType.STRING,
                description: "Loại biểu đồ (ví dụ: bar (cột), line (đường), pie (tròn)).",
            }
        },
        required: ["chartType"],
    },
};

export const vietnameseNavigationDeclaration: FunctionDeclaration = {
    name: "navigation",
    description: `Điều hướng người dùng đến một trang cụ thể trong trang web này hoặc đến một trang web hội nghị/tạp chí bên ngoài bằng cách mở một tab trình duyệt mới.
    - Đối với điều hướng NỘI BỘ: Cung cấp đường dẫn tương đối bắt đầu bằng '/'. Hệ thống sẽ tự động thêm URL gốc và ngôn ngữ (locale). Các đường dẫn nội bộ được phép là: ${internalPaths.join(', ')}. Ví dụ: {"url": "/conferences"}
    - Đối với các trang hội nghị/tạp chí BÊN NGOÀI: Cung cấp URL đầy đủ, hợp lệ bắt đầu bằng 'http://' hoặc 'https://'.`,
    parameters: {
        type: SchemaType.OBJECT, // Kiểu SchemaType.OBJECT
        properties: { // Thuộc tính
            url: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: `Đường dẫn nội bộ (bắt đầu bằng '/', ví dụ: '/dashboard') hoặc URL đầy đủ bên ngoài (bắt đầu bằng 'http://' hoặc 'https://', ví dụ: 'https://some-journal.com/article') để điều hướng đến.`
            }
        },
        required: ["url"] // Bắt buộc
    }
};

export const vietnameseOpenGoogleMapDeclaration: FunctionDeclaration = {
    name: "openGoogleMap",
    description: "Mở Google Maps trong một tab trình duyệt mới, hướng đến một chuỗi địa điểm cụ thể (ví dụ: thành phố, địa chỉ, địa danh). CHỈ sử dụng chức năng này SAU KHI đã lấy được chuỗi địa điểm, thường là từ các hàm 'getConferences' hoặc 'getJournals'.",
    parameters: {
        type: SchemaType.OBJECT, // Kiểu SchemaType.OBJECT
        properties: { // Thuộc tính
            location: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: "Chuỗi địa điểm địa lý để tìm kiếm trên Google Maps (ví dụ: 'Delphi, Hy Lạp', 'Tháp Eiffel, Paris', '1600 Amphitheatre Parkway, Mountain View, CA').",
            },
        },
        required: ["location"], // Bắt buộc
    },
};

export const vietnameseFollowUnfollowItemDeclaration: FunctionDeclaration = {
    name: "followUnfollowItem",
    description: "Theo dõi hoặc bỏ theo dõi một hội nghị hoặc tạp chí cụ thể cho người dùng đang đăng nhập. Yêu cầu xác định mục trước (ví dụ: sử dụng getConferences/getJournals).",
    parameters: {
        type: SchemaType.OBJECT, // Kiểu SchemaType.OBJECT
        properties: { // Thuộc tính
            itemType: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: "Loại của mục.",
                enum: ["conference", "journal"] // Giá trị được phép
            },
            identifier: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: "Một định danh duy nhất cho mục, chẳng hạn như từ viết tắt hoặc tiêu đề chính xác của nó, đã được truy xuất trước đó.",
            },
            identifierType: {
                 type: SchemaType.STRING, // Kiểu SchemaType.STRING
                 description: "Loại định danh được cung cấp.",
                 enum: ["acronym", "title", "id"], // Cho phép Model chỉ định nếu biết loại
            },
            action: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: "Hành động mong muốn thực hiện.",
                enum: ["follow", "unfollow"] // Giá trị được phép
            },
        },
        required: ["itemType", "identifier", "identifierType", "action"], // Bắt buộc
    },
};

export const vietnameseSendEmailToAdminDeclaration: FunctionDeclaration = {
    name: "sendEmailToAdmin",
    description: "Gửi một email đến quản trị viên trang web thay mặt cho người dùng. Sử dụng chức năng này khi người dùng muốn liên hệ rõ ràng với quản trị viên, báo cáo sự cố, cung cấp phản hồi, hoặc yêu cầu trợ giúp cụ thể cần sự can thiệp của quản trị viên. Bạn nên giúp người dùng soạn thảo chủ đề, nội dung thư và xác nhận loại yêu cầu ('contact' hoặc 'report') trước khi gọi hàm này.",
    parameters: {
        type: SchemaType.OBJECT, // Kiểu SchemaType.OBJECT
        properties: { // Thuộc tính
            subject: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: "Dòng chủ đề cho email gửi đến quản trị viên. Nên ngắn gọn và phản ánh mục đích của email.",
            },
            requestType: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: "Loại yêu cầu. Sử dụng 'contact' cho các yêu cầu chung, phản hồi, hoặc yêu cầu liên hệ. Sử dụng 'report' để báo cáo sự cố, lỗi, hoặc vấn đề với trang web hoặc nội dung của nó.",
                enum: ["contact", "report"], // Chỉ định các giá trị được phép
            },
            message: {
                type: SchemaType.STRING, // Kiểu SchemaType.STRING
                description: "Nội dung chính của thư email, trình bày chi tiết yêu cầu, báo cáo hoặc phản hồi của người dùng.",
            },
        },
        required: ["subject", "requestType", "message"], // Tất cả các trường là bắt buộc
    },
};