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



// Chinese

// --- 主机代理的新函数声明 ---
export const chineseRouteToAgentDeclaration: FunctionDeclaration = {
    name: "routeToAgent",
    description: "将特定任务路由到指定的专业代理。",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            targetAgent: {
                type: SchemaType.STRING,
                description: "要将任务路由到的专业代理的唯一标识符 (例如, 'ConferenceAgent')。",
            },
            taskDescription: {
                type: SchemaType.STRING,
                description: "为目标代理提供的任务的详细自然语言描述。",
            }
        },
        required: ["targetAgent", "taskDescription"],
    },
};

export const chineseGetConferencesDeclaration: FunctionDeclaration = {
    name: "getConferences",
    // 描述：清晰说明目的是创建查询字符串
    description: "根据用户指定的标准生成用于搜索会议的 URL 编码查询字符串。此查询字符串将用于从后端 API 获取数据。" +
        " 至关重要的是，查询字符串中的 *所有* 值都必须经过正确的 URL 编码，以确保后端 API 正确解释搜索条件。未能正确编码值可能导致错误的搜索结果或错误。" +
        " 请注意 URL 的最大长度，因为过长的查询字符串可能会被浏览器或服务器截断。如有必要，请考虑限制 `topics` 或 `researchFields` 参数的数量。" +
        " 后端 API 对某些参数（例如 `country`、`continent`）可能区分大小写。请确保值的字母大小写与预期格式匹配。" +
        " 一个结合多个标准的综合示例：`title=International+Conference+on+AI&topics=AI&topics=Machine+Learning&country=USA&fromDate=2024-01-01&toDate=2024-12-31&rank=A*`",
    parameters: {
        type: SchemaType.OBJECT, // 仍然是 OBJECT 以符合通用结构
        properties: {
            // 定义一个单一参数来包含查询字符串
            searchQuery: {
                type: SchemaType.STRING,
                // 描述：关于如何创建查询字符串的详细说明
                description: "根据用户的会议搜索标准构建的 URL 编码查询字符串。格式为以 '&' 分隔的 key=value 对。" +
                    "基于潜在用户查询的可用键包括：" +
                    "`title` (string): 会议的完整正式名称（例如：International Conference on Management of Digital EcoSystems）。" +
                    "`acronym` (string): 会议的缩写名称，通常用大写字母表示（例如：ICCCI, SIGGRAPH, ABZ）。" +
                    "`fromDate` (string, 例如：YYYY-MM-DD - 年-月-日), " +
                    "`toDate` (string, 例如：YYYY-MM-DD - 年-月-日), " +
                    "`topics` (string, 对于多个值重复键，例如：topics=AI&topics=ML - 主题=AI&主题=ML), " +
                    "`cityStateProvince` (string): 城市/州/省, " +
                    "`country` (string): 国家, " +
                    "`continent` (string): 大洲, " +
                    "`address` (string): 地址, " +
                    "`researchFields` (string, 对于多个值重复键): 研究领域, " +
                    "`rank` (string): 排名 (例如: A*, A, B, C), " +
                    "`source` (string): 来源 (例如: CORE, Scopus), " +
                    "`accessType` (string): 访问类型 (例如: Open Access - 开放获取), " +
                    "`keyword` (string): 关键词, " +
                    "`subFromDate` (string): 投稿开始日期, `subToDate` (string): 投稿截止日期, " +
                    "`cameraReadyFromDate` (string): 终稿提交开始日期, `cameraReadyToDate` (string): 终稿提交截止日期, " +
                    "`notificationFromDate` (string): 录用通知开始日期, `notificationToDate` (string): 录用通知截止日期, " +
                    "`registrationFromDate` (string): 注册开始日期, `registrationToDate` (string): 注册截止日期, " +
                    "`mode` (string): 如果用户请求详细信息，值始终为 `detail`。" +
                    "`perPage` (number): 每页返回的会议数量。如果用户指定了数量，则使用该值。如果用户未指定数量，则默认为 5。" +
                    "`page` (number): 要返回的结果页码。如果用户想查看下一组会议，请使用 page=2, page=3 等。如果用户未指定页码，则默认为 1。" +
                    "确保所有值都经过正确的 URL 编码（例如，空格变成 + 或 +）。" +

                    "**区分标题 (Title) 和缩写 (Acronym):** 正确识别用户提供的是完整的会议标题还是缩写至关重要。区分方法如下：" +
                    "* **标题 (Title):** 这是会议的完整、未缩写的名称。它通常是一个描述会议重点的短语或句子。示例：'International Conference on Machine Learning'。对此使用 `title` 参数。" +
                    "* **缩写 (Acronym):** 这是会议名称的简短、通常大写的缩写。示例：'ICML' (代表 International Conference on Machine Learning)。对此使用 `acronym` 参数。" +

                    "**示例:**" +
                    "* 用户查询：'查找关于 ICML 的会议'。 `searchQuery=acronym=ICML&perPage=5&page=1` (默认 perPage 和 page)" +
                    "* 用户查询：'搜索 International Conference on Management of Digital EcoSystems'。 `searchQuery=title=International+Conference+on+Management+of+Digital+EcoSystems&perPage=5&page=1` (默认 perPage 和 page)" +
                    "* 用户查询：'查找 MEDES 会议'。 `searchQuery=acronym=MEDES&perPage=5&page=1` (默认 perPage 和 page)" +
                    "* 用户查询：'搜索全称为 International Conference on Recent Trends in Image Processing, Pattern Recognition and Machine Learning 的会议'。 `searchQuery=title=International+Conference+on+Recent+Trends+in+Image+Processing,+Pattern+Recognition+and+Machine+Learning&perPage=5&page=1` (默认 perPage 和 page)" +
                    "* 用户查询 1: '查找美国的 3 个会议'。 `searchQuery=country=USA&perPage=3&page=1` 用户查询 2: '查找美国的另外 5 个会议'。 `searchQuery=country=USA&perPage=5&page=2`" +

                    "例如，如果一个主题同时包含空格和特殊字符，如 'Data Science & Analysis'，则应编码为 'Data+Science+&+Analysis'。" +
                    "如果用户未为特定键指定值，则应将其完全从查询字符串中省略。不要包含值为空的键（例如 `title=`）。" +
                    "要指定多个主题或研究领域，请为每个值重复该键。例如：`topics=AI&topics=Machine+Learning&researchFields=Computer+Vision&researchFields=Natural+Language+Processing`。" +
                    "始终对值中的特殊字符进行 URL 编码。例如，使用 `+` 表示空格，`&` 表示 & 符号，`=` 表示等号，`+` 表示加号。" +
                    "要搜索两个日期之间的会议，请使用 `fromDate` 和 `toDate`。例如，要搜索 2023 年 1 月 1 日至 2023 年 12 月 31 日之间举行的会议，请使用 `fromDate=2023-01-01&toDate=2023-12-31`。" +
                    "如果用户请求有关会议的 *详细* 信息（例如，完整描述、具体日期、征稿启事、摘要等），请在查询字符串中包含参数 `mode=detail`。"
            }
        },
        // 描述：确保 Gemini 始终提供此参数
        required: ["searchQuery"]
    }
};

export const chineseGetJournalsDeclaration: FunctionDeclaration = {
    name: "getJournals",
    description: "根据筛选条件检索期刊信息。",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            "Rank": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选的期刊排名列表。",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "Title": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选的期刊标题列表。",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Issn": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选的期刊 ISSN 列表。",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "SJR": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选的期刊 SJR 值列表。",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "SJRBestQuartile": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选的期刊 SJR 最佳分区 (SJR Best Quartile) 值列表。",
                "items": {
                    "type": SchemaType.STRING // 可能是 Q1, Q2, Q3, Q4
                }
            },
            "HIndex": {
                "type": SchemaType.INTEGER,
                "description": "用于筛选的期刊 H 指数 (H index)。"
            },
            "Country": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选期刊的国家列表。",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Region": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选期刊的地区列表。",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Publisher": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选期刊的出版商列表。",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Areas": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选期刊的领域 (areas) 列表。",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Categories": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选期刊的类别 (categories) 列表。",
                "items": {
                    "type": SchemaType.STRING
                }
            },
            "Overton": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选期刊的 Overton 值列表。",
                "items": {
                    "type": SchemaType.NUMBER
                }
            },
            "SDG": {
                "type": SchemaType.ARRAY,
                "description": "用于筛选期刊的可持续发展目标 (SDGs) 列表。",
                "items": {
                    "type": SchemaType.STRING // 通常是 SDG 的编号或代码
                }
            }
        }
    },
};

export const chineseGetWebsiteInfoDeclaration: FunctionDeclaration = {
    name: "getWebsiteInfo",
    description: "检索有关网站的信息。此函数不需要参数，直接调用即可。"
};

export const chineseDrawChartDeclaration: FunctionDeclaration = {
    name: "drawChart",
    description: "根据提供的数据绘制图表。",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            chartType: {
                type: SchemaType.STRING,
                description: "图表的类型（例如：bar (柱状图), line (折线图), pie (饼图)）。",
            }
        },
        required: ["chartType"],
    },
};

export const chineseNavigationDeclaration: FunctionDeclaration = {
    name: "navigation",
    description: `通过打开新的浏览器标签页，将用户导航到本网站内的指定页面或外部会议/期刊网站。
    - 对于内部导航：提供以 '/' 开头的相对路径。系统将自动添加基本 URL 和区域设置。允许的内部路径有：${internalPaths.join(', ')}。示例：{"url": "/conferences"}
    - 对于外部会议/期刊网站：提供以 'http://' 或 'https://' 开头的完整有效 URL。`,
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            url: {
                type: SchemaType.STRING,
                description: `要导航到的内部路径（以 '/' 开头，例如 '/dashboard'）或完整的外部 URL（以 'http://' 或 'https://' 开头，例如 'https://some-journal.com/article'）。`
            }
        },
        required: ["url"]
    }
};

export const chineseOpenGoogleMapDeclaration: FunctionDeclaration = {
    name: "openGoogleMap",
    description: "在新的浏览器标签页中打开 Google 地图，并指向特定的位置字符串（例如：城市、地址、地标）。仅在获取位置字符串之后（通常来自 'getConferences' 或 'getJournals' 函数）才使用此功能。",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            location: {
                type: SchemaType.STRING,
                description: "要在 Google 地图上搜索的地理位置字符串（例如：'希腊德尔斐'、'巴黎埃菲尔铁塔'、'1600 Amphitheatre Parkway, Mountain View, CA'）。",
            },
        },
        required: ["location"],
    },
};

export const chineseFollowUnfollowItemDeclaration: FunctionDeclaration = {
    name: "followUnfollowItem",
    description: "为当前登录的用户关注或取消关注特定的会议或期刊。需要先识别该项目（例如，使用 getConferences/getJournals）。",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            itemType: {
                type: SchemaType.STRING,
                description: "项目的类型。",
                enum: ["conference", "journal"]
            },
            identifier: {
                type: SchemaType.STRING,
                description: "项目的唯一标识符，例如其缩写或先前检索到的确切标题。",
            },
            identifierType: {
                 type: SchemaType.STRING,
                 description: "所提供标识符的类型。",
                 enum: ["acronym", "title", "id"], // 允许模型在知道类型时指定
            },
            action: {
                type: SchemaType.STRING,
                description: "要执行的期望操作。",
                enum: ["follow", "unfollow"]
            },
        },
        required: ["itemType", "identifier", "identifierType", "action"],
    },
};

export const chineseSendEmailToAdminDeclaration: FunctionDeclaration = {
    name: "sendEmailToAdmin",
    description: "代表用户向网站管理员发送电子邮件。当用户明确希望联系管理员、报告问题、提供反馈或请求需要管理员干预的特定帮助时，使用此功能。在调用此函数之前，您应该帮助用户构思主题、消息内容，并确认请求类型（'contact' 或 'report'）。",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            subject: {
                type: SchemaType.STRING,
                description: "发送给管理员的电子邮件的主题行。应简洁并反映邮件的目的。",
            },
            requestType: {
                type: SchemaType.STRING,
                description: "请求的类型。对于一般查询、反馈或联系请求，使用 'contact'。对于报告网站或其内容的问题、错误，使用 'report'。",
                enum: ["contact", "report"], // 指定允许的值
            },
            message: {
                type: SchemaType.STRING,
                description: "电子邮件消息的主要正文/内容，详细说明用户的请求、报告或反馈。",
            },
        },
        required: ["subject", "requestType", "message"], // 所有字段都是必填项
    },
};