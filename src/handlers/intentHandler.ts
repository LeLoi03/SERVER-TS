//src/handlers/intentHandler.ts
import {
  filterConferences,
  filterJournals,
  determineUserIntent,
} from "./filterInformationHandler";
import logToFile from "../utils/logger";
import { HistoryItem, ChatResponse } from "../shared/types";
import { GeminiService } from "../gemini/geminiService";
import { loadModelConfig, ModelConfig } from '../gemini/configLoader'; // Import ModelConfig

// --- Configuration (from environment) ---
const API_KEY = process.env.GEMINI_API_KEY;
const CHATBOT_MODEL_NAME = process.env.CHATBOT_MODEL_NAME || "gemini-2.0-flash";
const VISUALIZE_MODEL_NAME = process.env.VISUALIZE_MODEL_NAME || "gemini-2.0-flash";

// Load the configs ONCE
const chatbotGenerationConfig: ModelConfig = loadModelConfig("CHATBOT");  // Keep the type
const visualizeGenerationConfig: ModelConfig = loadModelConfig("VISUALIZE"); // Keep the type

// --- System Instructions (from .env) ---

interface SystemInstructions {
  Conference: string;
  Journal: string;
  Website: string;
  Chart: string;
}


const SYSTEM_INSTRUCTIONS: SystemInstructions = {
  Conference: `
**Your Role:** ${process.env.CONFERENCE_ROLE}

**Task:** ${process.env.CONFERENCE_TASK}

**Response Requirements:** ${process.env.CONFERENCE_RESPONSE_REQUIREMENTS}

**Conversational Flow and Friendliness:** ${process.env.CONFERENCE_CONVERSATIONAL_FLOW}

**Important Considerations:** ${process.env.CONFERENCE_IMPORTANT_CONSIDERATIONS}
`,
  Journal: `
**Your Role:** ${process.env.JOURNAL_ROLE}

**Task:** ${process.env.JOURNAL_TASK}

**Response Requirements:** ${process.env.JOURNAL_RESPONSE_REQUIREMENTS}

**Conversational Flow and Friendliness:** ${process.env.JOURNAL_CONVERSATIONAL_FLOW}

**Important Considerations:** ${process.env.JOURNAL_IMPORTANT_CONSIDERATIONS}
`,
  Website: `
**Your Role:** ${process.env.WEBSITE_ROLE}

**Task:** ${process.env.WEBSITE_TASK}

**Response Requirements:** ${process.env.WEBSITE_RESPONSE_REQUIREMENTS}

**Conversational Flow and Friendliness:** ${process.env.WEBSITE_CONVERSATIONAL_FLOW}

**Important Considerations:** ${process.env.WEBSITE_IMPORTANT_CONSIDERATIONS}
`,
 Chart: `
**Role:** You are an **Expert Data Visualization Assistant**, highly skilled in creating Echarts configurations and PostgreSQL queries. Your goal is to translate user data visualization requests into JSON output containing an Echarts configuration, a PostgreSQL query, and an easily understandable description.

**Instruction:**

1.  **Analyze User Request:**
*   Carefully read and understand the user's question to determine the type of chart they want to create, the data they want to visualize, and specific visual elements (axes, data series, filters, grouping).
*   Clearly identify the components of the chart requested by the user:
*   **Chart Type:** (e.g., bar chart, line chart, pie chart, scatter chart, stacked bar chart). If not specified, choose the most appropriate chart type based on the data and visualization goal (e.g., stacked bar for "breakdown," bar/line for comparison, pie chart for proportions).
*   **X-axis (xAxis):** Determine which column from the "public."Visualize"" table should be used as the X-axis (usually categories or groups).
*   **Y-axis (yAxis):** Determine which column or metric should be used as the Y-axis (usually numerical values, counts, percentages).
*   **Data Series (series):** Identify which data series need to be displayed on the chart. These may correspond to different columns or different groups within the data. For stacked charts, data series will be stacked on top of each other.
*   **Filters (filters):** Identify any data filtering conditions requested (e.g., specific data sources, ranks, years, countries, topics, publishers).
*   **Grouping (grouping):** Determine how the data should be grouped (e.g., by continent, by conference type, by topic).
*   **Other Customizations:** Titles, subtitles, legends, colors, labels, tooltips, etc.

2.  **Generate PostgreSQL Query:**
*   Based on the user's request, construct a PostgreSQL query to retrieve the necessary data from the "public."Visualize"" table.
*   **Important:** Ensure the "SELECT" clause in the SQL query returns columns in the correct order to match the axes and data series defined in the Echarts configuration.
*   The first column selected should usually correspond to the X-axis (categories/groups).
*   Subsequent columns selected should usually correspond to the data series (values).
*   If there is a "GROUP BY" clause, the grouped columns will typically link to the X-axis categories.
*   Aggregate functions like "COUNT(*), SUM(), AVG()" will provide values for the data series (Y-axis).
*   Use "GROUP BY" and "WHERE" clauses as needed to filter and aggregate data according to the user's request.
*   Use the "IN" operator for filtering conditions on columns like "Source", "Rank", "Topics", "Publisher" when the user specifies multiple values.

3.  **Create Echarts JSON Configuration:**
*   Create a JSON object representing the Echarts configuration.
*   Select the appropriate chart type (e.g., 'bar', 'line', 'pie', 'scatter', 'bar - stack').
*   Configure "xAxis", "yAxis", "series", "title", "legend", "tooltip", "grid", "backgroundColor", and other Echarts options based on the user's request and best data visualization practices.
*   "xAxis.data" will be populated with data from the first column returned by the PostgreSQL query.
*   The "series" array will contain objects, each corresponding to a column (or combination of columns) from the PostgreSQL query (after the first column for xAxis). "series[i].data" will be populated with data from the (i+1)-th column returned from SQL.
*   For stacked bar charts, use the "stack" property in "series" to group data series together.
*   Customize Echarts properties to make the chart clear, readable, and aesthetically pleasing (e.g., "axisLabel.rotate" for long X-axis labels, "itemStyle.color" for color customization, "label.show" and "label.position" to display data labels, "tooltip.formatter" to customize tooltips).

4.  **Write Description:**
*   Create a concise, informative, and easily understandable description of the chart.
*   Explain what the chart visualizes, based on what data (mention the table and relevant columns/filters), and how to interpret the chart.
*   **Context-aware and Conversation History Sensitive Description:**
*   If this is the first chart or a completely new chart, clearly describe the current chart, including: chart type, data used (table, columns, filters), what the X and Y axes represent, what the data series are, and the overall meaning of the chart.
*   If the user is refining or modifying a previous chart, emphasize the changes compared to the previous chart in the description. For example: "This chart is an update to the previous one, now grouped by continent and filtered to CORE2023 and CORE2021 sources and Ranks A, B, and C." Clearly list what elements have been added, modified, or removed compared to the previous request.
*   Use clear and simple language, understandable for non-experts.
*   Highlight important elements of the chart, such as: colors, legends, data labels, tooltips, and how they help users understand the data.
*   Ensure the description accurately reflects the generated Echarts configuration and PostgreSQL query.

5.  **Format JSON Output:**
*   Package the Echarts JSON configuration, PostgreSQL query, and description into a single JSON object with the keys: "Echarts", "PostgresSQL", and "Description".

**Situation:**

You are working with a database containing conference information in the "public."Visualize"" table. This table has the following schema:

| Column      | Data Type | Description                                                                      |
| :---------- | :-------- | :------------------------------------------------------------------------------- |
| Acronym     | TEXT      | Conference acronym/name                                                          |
| Source      | TEXT      | Conference ranking source (e.g., CORE2023, CORE2021, CORE2020, CORE2018, CORE2017) |
| Rank        | TEXT      | Conference rank (e.g., A*, A, B, C, National, Regional, Unranked)              |
| Rating      | NUMERIC   | Conference ranking value                                                          |
| Year        | NUMERIC   | Ranking year (e.g., 2025, 2024)                                                 |
| Country     | TEXT      | Host country of the conference                                                    |
| Continent   | TEXT      | Continent of the host country (e.g., Asia, North America, Europe)                 |
| Type        | TEXT      | Conference type (e.g., Offline, Online, Hybrid)                                   |
| Topics      | TEXT      | Conference topic                                                                 |
| Publisher   | TEXT      | Conference publisher                                                              |

Users will ask questions in natural language requesting visualizations of this conference data. You need to generate JSON responses that enable visualization using Echarts and data retrieval using PostgreSQL.

**Example Conversation History and Description Evolution:**

*Please note that the following "Example Conversation History and Description Evolution" section is **only for illustrating how the description should evolve based on conversation history.**  The examples for Echarts and PostgreSQL configurations are provided separately. **You must carefully examine the provided Echarts and PostgreSQL examples from the example questions to understand the desired output format and logic for generating accurate Echarts and PostgreSQL outputs.**  Focus on replicating the style and structure demonstrated in those examples when generating your responses.*

User 1: Create a stacked bar chart showing conference rank breakdown.

Example description of JSON Output 1:

This stacked bar chart displays the distribution of conference ranks (Rank) across all available sources and continents in the data. Each bar represents a rank (A*, A, B, C, National, Regional, Unranked), and the height of the bar represents the number of conferences with that rank. The chart helps you quickly visualize the overall distribution of conference ranks in the database.

User 2: Group the bars by continent.

Example description of JSON Output 2: (Similar to the provided example, now grouped by continent)

This chart is an update to the previous one, now grouped by continent. Each bar now represents a continent and is segmented into different colored sections, each section corresponding to a conference rank (A*, A, B, C, National, Regional, Unranked). This chart allows you to compare the distribution of conference ranks across different continents. For example, you can easily see which continent has the most A*-ranked conferences, or which continent has a more balanced rank distribution.

User 3: Only include conferences from the CORE2023 and CORE2021 source and Rank A, B, C.

Example description of JSON Output 3: (The final example provided, with filters applied and description updated).

This chart is a further update from the previous chart, but now only includes conferences from the CORE2023 and CORE2021 sources and only displays Ranks A, B, and C. Key changes include:

Data Sources: Only using data from CORE2023 and CORE2021.

Ranks: Only showing Ranks A, B, and C.
The chart retains the stacked bar structure grouped by continent, but the data has been filtered to focus on the specified sources and ranks. This helps you analyze the distribution of Ranks A, B, C across continents within the CORE2023 and CORE2021 datasets."
            
 `
};

function getSystemInstruction(intent: string): string {
  logToFile(`Getting system instruction for intent: ${intent}`); // Log intent
  const instruction = SYSTEM_INSTRUCTIONS[intent as keyof SystemInstructions] || SYSTEM_INSTRUCTIONS.Website;
  logToFile(`System instruction retrieved: ${instruction.substring(0, 100)}...`); // Log a snippet of the instruction
  return instruction;
}


// --- Gemini Instances ---
const chatbotService = new GeminiService(API_KEY!, CHATBOT_MODEL_NAME); // No config prefix needed
const visualizeService = new GeminiService(API_KEY!, VISUALIZE_MODEL_NAME); // No config prefix needed
// --- Type Definitions ---

interface Criteria {
  [key: string]: any;
}

interface ChartData {
  echartsConfig: any;
  sqlQuery: string;
  description: string;
}

interface UserIntentRedirect {
  Value: string;
  Message: string;
  Type: "Internal website" | "External website";
}

export interface UserIntent {
  Redirect?: UserIntentRedirect;
  Intent?: string[];
  About?: string;
  Description?: string;
}

// --- Helper Functions ---
/**
* Extracts user questions from the history.
*/
async function extractUserQuestions(history: HistoryItem[]): Promise<string[]> {
  await logToFile(`Extracting user questions from history. History length: ${history.length}`);
  const questions = history
    .filter(entry => entry.role === "user")
    .map((entry, index) => `User question ${index + 1}: ${entry.parts[0].text}`);
  await logToFile(`Extracted user questions: ${JSON.stringify(questions)}`);
  return questions;
}

// --- Intent Handlers ---

export async function handleFindInformationConferenceIntent(criteria: Criteria): Promise<string> {
  logToFile(`Filtering conferences with criteria: ${JSON.stringify(criteria)}`);
  try {
    const filterCriteria = criteria["Filter conference"];
    const conferenceResults = await filterConferences(
      filterCriteria,
      "./evaluate.csv",
      "./output.txt"
    );
    logToFile(`filterConferences result (raw): ${conferenceResults}`); // Log raw result

    return conferenceResults; // Trả về chuỗi kết quả trực tiếp
  } catch (error) {
    console.error("Error filtering conference data:", error);
    logToFile(`Error filtering conference data: ${error}`); // Log the error
    return ""; // Return empty array on error
  }
}

export async function handleFindInformationJournalIntent(criteria: Criteria): Promise<string> {
  await logToFile(`Filtering journals with criteria: ${JSON.stringify(criteria)}`);
  try {
    const filterCriteria = criteria["Filter journal"];
    const journalResults = await filterJournals(
      filterCriteria,
      "./scimagojr_2023.csv",
      "./journal_output.txt"
    );
    await logToFile(`filterJournals result (raw): ${journalResults}`); // Log raw result
    return journalResults;
  } catch (error) {
    console.error("Error filtering journal data:", error);
    await logToFile(`Error filtering journal data: ${error}`); // Log the error

    return ""; // Return empty array on error
  }
}

export async function handleDrawChartIntent(history: HistoryItem[], intent: string): Promise<ChatResponse> {
  const systemInstruction = getSystemInstruction(intent);
  const chartQuestionsHistory = history.filter(entry => (entry.role === 'user' && entry.type !== 'text'))
    .map((entry, index) => `User question ${index + 1}: ${entry.parts[0].text}`)
    .join("\n");

  logToFile(`Chart questions history: ${JSON.stringify(chartQuestionsHistory)}`);
  const parts = [
    { text: "input: User question 1: Create a stacked bar chart showing conference rank breakdown.\nUser question 2: Group the bars by continent.\nUser question 3: Only include conferences from the CORE2023 and CORE2021 source and Rank A, B, C." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Rank Breakdown per Continent\",\n      \"subtext\": \"CORE2023, CORE2021, Ranks A, B, and C\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      },\n      \"subtextStyle\": {\n        \"fontSize\": 14,\n        \"color\": \"#333\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Continent\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"rotate\": 45,\n        \"fontSize\": 12\n      },\n      \"axisTick\": {\n        \"show\": false\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      },\n      \"axisTick\": {\n        \"show\": false\n      }\n    },\n    \"legend\": {\n      \"orient\": \"vertical\",\n      \"right\": 10,\n      \"top\": \"middle\",\n      \"itemGap\": 10,\n      \"textStyle\": {\n        \"fontSize\": 14\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Rank A\",\n        \"type\": \"bar\",\n        \"stack\": \"rank\",\n        \"itemStyle\": {\n          \"color\": \"#675bba\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"inside\",\n          \"formatter\": \"{c}\",\n          \"fontSize\": 10\n        }\n      },\n      {\n        \"name\": \"Rank B\",\n        \"type\": \"bar\",\n        \"stack\": \"rank\",\n        \"itemStyle\": {\n          \"color\": \"#d48265\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"inside\",\n          \"formatter\": \"{c}\",\n          \"fontSize\": 10\n        }\n      },\n      {\n        \"name\": \"Rank C\",\n        \"type\": \"bar\",\n        \"stack\": \"rank\",\n        \"itemStyle\": {\n          \"color\": \"#91c7ae\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"inside\",\n          \"formatter\": \"{c}\",\n          \"fontSize\": 10\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"shadow\"\n      },\n      \"formatter\": \"function (params) { \\n  let total = 0; \\n  let result = params[0] && params[0].name ? params[0].name + '' : 'No Data'; \\n\\n  params.forEach(param => { \\n    if (param.value !== null && param.value !== undefined) { \\n      total += Number(param.value); \\n      result += param.marker + ' ' + param.seriesName + ': ' + param.value + ''; \\n    } else { \\n      result += param.marker + ' ' + param.seriesName + ': N/A'; \\n    } \\n  }); \\n\\n  if (total > 0) { \\n    result += 'Total: ' + total + ''; \\n  } \\n  return result; \\n}\"\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"15%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Continent\\\", \\\"Rank\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Source\\\" IN ('CORE2023', 'CORE2021') AND \\\"Rank\\\" IN ('A', 'B', 'C') GROUP BY \\\"Continent\\\", \\\"Rank\\\"\",\n  \"Description\": \"This stacked bar chart displays the distribution of conference ranks (A, B, and C) across different continents, based on data from **CORE2023** and **CORE2021**. Each bar represents a continent, and is segmented into three colors corresponding to the three ranks:\\n\\n*   Purple for Rank **A**\\n*   Orange for Rank **B**\\n*   Green for Rank **C**\\n\\nIt's easy to compare the number of conferences in each rank between continents.  For example, you can quickly identify which continent has the most A-ranked conferences, or which has a more balanced distribution.  The labels on the x-axis (continent names) are *rotated* for better readability. The y-axis shows the number of conferences.\\n\\nThe faint horizontal grid lines help with estimating the quantities.  The legend on the right clarifies which color corresponds to each rank.\\n\\n> Overall, this chart provides a clear picture of conference \\\"quality\\\" (as measured by A, B, C rankings) across different regions of the world, based on the CORE data.  The numbers inside each bar segment show the exact count. Hovering over each segment provides detailed information for each continent. The main title and subtitle give full information about the chart.\"\n}" },
    { text: "input: User question 1: Draw a bar chart showing the number of conferences by continent.\nUser question 2: Change it to a pie chart.\nUser question 3: Add the title \"Conference Distribution by Continent\"." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Distribution by Continent\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"tooltip\": {\n      \"trigger\": \"item\",\n      \"formatter\": \"{a}  {b} : {c} ({d}%)\"\n    },\n    \"legend\": {\n      \"orient\": \"vertical\",\n      \"left\": \"left\",\n      \"top\": \"middle\",\n      \"itemGap\": 10,\n      \"textStyle\": {\n        \"fontSize\": 14\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Number of Conferences\",\n        \"type\": \"pie\",\n        \"radius\": [\n          \"40%\",\n          \"70%\"\n        ],\n        \"center\": [\n          \"55%\",\n          \"50%\"\n        ],\n        \"avoidLabelOverlap\": true,\n        \"label\": {\n          \"show\": true,\n          \"position\": \"outside\",\n          \"formatter\": \"{b}: {d}%\",\n          \"fontSize\": 12\n        },\n        \"labelLine\": {\n          \"show\": true,\n          \"length\": 10,\n          \"length2\": 15\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"backgroundColor\": \"#f5f5f5\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Continent\\\", COUNT(*) AS \\\"NumofConferences\\\" FROM public.\\\"Visualize\\\" GROUP BY \\\"Continent\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis pie chart visualizes the distribution of conferences across different continents.  Each slice of the pie represents a continent, and the size of the slice is proportional to the number of conferences held in that continent. The chart uses a donut shape (inner radius 40%, outer radius 70%) for improved readability and visual appeal. The chart title is \\\"Conference Distribution by Continent\\\".\\n\\n**Key Features:**\\n\\n*   **Proportional Representation:** The size of each slice directly corresponds to the number of conferences in that continent, making it immediately clear which continents host the most and fewest conferences.\\n*   **Percentage Labels:** The percentage of conferences for each continent is displayed clearly on the *outside* of the pie. This provides easy understanding of the relative proportions.\\n*   **Interactive Legend:** A legend on the left-hand side lists all continents included in the data.\\n*   **Detailed Tooltip:** Hovering over a slice reveals the *exact number* of conferences for that continent, along with the continent name and percentage.\\n\\n**Data Source:**\\n\\nThe data for this chart is obtained by counting the number of conferences associated with each continent in the database.\"\n}" },
    { text: "input: User question 1: Create a line chart showing the number of conferences per source.\nUser question 2: Compare conferences of Asia, Europe and North America Continent on the same chart.\nUser question 3: Make the line for North America purple." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Trend by Source and Continent\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Source\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Asia\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#2980b9\"\n        },\n        \"areaStyle\": {}\n      },\n      {\n        \"name\": \"Europe\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#27ae60\"\n        },\n        \"areaStyle\": {}\n      },\n      {\n        \"name\": \"North America\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"purple\"\n        },\n        \"areaStyle\": {}\n      }\n    ],\n    \"legend\": {\n      \"left\": \"left\",\n      \"top\": \"middle\",\n      \"orient\": \"vertical\",\n      \"textStyle\": {\n        \"fontSize\": 14\n      }\n    },\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"cross\"\n      }\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"4%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Source\\\", \\\"Continent\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Continent\\\" IN ('Asia', 'Europe', 'North America') GROUP BY \\\"Source\\\", \\\"Continent\\\" ORDER BY \\\"Source\\\" ASC\",\n  \"Description\": \"**Overview:**\\n\\nThis line chart compares the number of conferences over different sources for three continents: Asia, Europe, and North America.  Each line represents a continent, allowing for a direct comparison of conference trends across sources. The chart title is *\\\"Conference Trend by Source and Continent\\\"*. The x-axis represents various Sources and the y-axis shows Number of Conferences.\\n\\n**Key Features:**\\n\\n*   **Multiple Lines:** Three distinct lines represent Asia (blue), Europe (green), and North America (purple), facilitating a clear visual comparison of their conference trends.\\n*   **Smooth Lines:**  The lines are smoothed, providing a more visually appealing and easier-to-interpret representation of the trends.\\n* **Area Style**: The area below each line is filled.\\n*   **Interactive Legend:** A vertical legend on the left identifies each continent and its corresponding line color.\\n*   **Detailed Tooltip:** Hovering over any point on the lines displays the exact number of conferences for that continent and source, along with crosshair lines to pinpoint the x and y values.\\n\\n**Data Source and Filtering:**\\n\\nThe data is sourced from the database and specifically filters for conferences in Asia, Europe, and North America.  The query groups the data by source and continent, then counts the number of conferences in each group.\"\n}" },
    { text: "input: User question 1: Show me a pie chart of conference types (Offline, Online, Hybrid)." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Type Distribution\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"tooltip\": {\n      \"trigger\": \"item\",\n      \"formatter\": \"{a} {b}: {c} ({d}%)\"\n    },\n    \"legend\": {\n      \"orient\": \"vertical\",\n      \"left\": \"left\",\n      \"top\": \"middle\",\n      \"itemGap\": 10,\n      \"textStyle\": {\n        \"fontSize\": 14\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Conference Types\",\n        \"type\": \"pie\",\n        \"radius\": [\n          \"40%\",\n          \"70%\"\n        ],\n        \"center\": [\n          \"55%\",\n          \"50%\"\n        ],\n        \"avoidLabelOverlap\": true,\n        \"label\": {\n          \"show\": true,\n          \"position\": \"outside\",\n          \"formatter\": \"{b}: {d}%\",\n          \"fontSize\": 12\n        },\n        \"labelLine\": {\n          \"show\": true,\n          \"length\": 10,\n          \"length2\": 15\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"backgroundColor\": \"#f5f5f5\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Type\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" GROUP BY \\\"Type\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis pie chart illustrates the distribution of different conference types (Offline, Online, Hybrid).  Each slice of the pie represents a particular conference type, with the size of the slice being proportional to the number of conferences of that type. The chart uses a donut shape (inner radius 40%, outer radius 70%) and the title *\\\"Conference Type Distribution\\\"* sits at the top.\\n\\n**Key Features:**\\n\\n*   **Proportional Representation:**  The area of each slice directly corresponds to the number of conferences of that type (Offline, Online, or Hybrid), making it easy to compare their prevalence.\\n*   **Percentage Labels:** Each slice has a label showing the *percentage* of conferences belonging to that type, providing clear relative proportions.\\n*   **Interactive Legend:** A vertical legend on the left side lists the different conference types.\\n*   **Detailed Tooltip:** Hovering over a slice reveals the *exact number* of conferences of that type, along with the type name and percentage.\\n*   **Emphasis on Hover:**  When you hover over a slice, it's highlighted with a shadow effect for better visual feedback.\\n\\n**Data Source:**\\n\\nThe data is derived by counting the number of conferences for each distinct type ('Offline', 'Online', 'Hybrid') in the database.\"\n}" },
    { text: "input: User question 1: Show a bar chart of the top 5 countries with the most conferences." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Top 5 Countries Hosting Conferences\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Country\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"rotate\": 45,\n        \"fontSize\": 12\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Number of Conferences\",\n        \"type\": \"bar\",\n        \"itemStyle\": {\n          \"color\": \"#4c8daf\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"top\",\n          \"fontSize\": 12\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"shadow\"\n      }\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"4%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Country\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" GROUP BY \\\"Country\\\" ORDER BY \\\"NumOfConferences\\\" DESC LIMIT 5\",\n  \"Description\": \"**Overview:**\\n\\nThis bar chart displays the top 5 countries with the highest number of conferences.  Each bar represents a country, and the height of the bar indicates the total number of conferences hosted in that country.  The chart is titled *\\\"Top 5 Countries Hosting Conferences\\\"*. The x-axis displays the Country and the y-axis is the Number of Conferences.\\n\\n**Key Features:**\\n\\n*   **Top 5 Ranking:** The chart focuses exclusively on the top 5 countries, providing a clear and concise comparison of the leading conference hosts.\\n*   **Bar Representation:**  Each country is represented by a bar, with the height directly proportional to the number of conferences.\\n*   **Value Labels:**  The exact number of conferences for each country is displayed *above* each bar, providing precise data.\\n*   **Interactive Tooltip:** Hovering over a bar reveals the country name and the number of conferences in a tooltip. The tooltip also uses a shadow effect for the axis pointer.\\n*  **Emphasis on Hover:** When you hover over a bar, it gets highlighted.\\n* **Rotated X-axis Labels:** Country names on the x-axis are *rotated 45 degrees* for better readability, especially if the names are long.\\n\\n**Data Source and Filtering:**\\n\\nThe data is retrieved from the database, and the query specifically selects the top 5 countries based on the number of conferences, ordered in descending order.\"\n}" },
    { text: "input: User question 1: Create a stacked bar chart showing the breakdown of conference rank (A, B, C) for each source over the last 2 source." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Rank Breakdown per Source (Last 2 Sources)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Source\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"legend\": {\n      \"orient\": \"vertical\",\n      \"right\": 10,\n      \"top\": \"middle\",\n      \"itemGap\": 10,\n      \"textStyle\": {\n        \"fontSize\": 14\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Rank A\",\n        \"type\": \"bar\",\n        \"stack\": \"rank\",\n        \"itemStyle\": {\n          \"color\": \"#675bba\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"inside\",\n          \"formatter\": \"{c}\",\n          \"fontSize\": 12\n        }\n      },\n      {\n        \"name\": \"Rank B\",\n        \"type\": \"bar\",\n        \"stack\": \"rank\",\n        \"itemStyle\": {\n          \"color\": \"#d48265\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"inside\",\n          \"formatter\": \"{c}\",\n          \"fontSize\": 12\n        }\n      },\n      {\n        \"name\": \"Rank C\",\n        \"type\": \"bar\",\n        \"stack\": \"rank\",\n        \"itemStyle\": {\n          \"color\": \"#91c7ae\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"inside\",\n          \"formatter\": \"{c}\",\n          \"fontSize\": 12\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"shadow\"\n      },\n      \"formatter\": \"{a} {b}: {c}\"\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"10%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Source\\\", \\\"Rank\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Rank\\\" IN ('A', 'B', 'C') AND \\\"Source\\\" IN ('CORE2023', 'CORE2021') GROUP BY \\\"Source\\\", \\\"Rank\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis stacked bar chart shows the distribution of conference ranks (A, B, and C) for each source.  The chart focuses on the last two sources ('CORE2023', 'CORE2021').  Each bar represents a source, and the bar is segmented to show the number of conferences of each rank (A, B, C) within that source. The chart's title is *\\\"Conference Rank Breakdown per Source (Last 2 Sources)\\\"*. The x-axis is Source and y-axis shows Number of conferences.\\n\\n**Key Features:**\\n\\n*   **Stacked Bars:** Each bar is divided into colored segments representing the number of conferences with ranks A (purple), B (orange), and C (green).  This stacking allows for easy comparison of the rank distribution within each source.\\n*   **Rank Breakdown:**  The chart clearly shows the proportion of A, B, and C ranked conferences for each source.\\n*   **Value Labels:** The *number* of conferences for each rank is displayed *inside* each segment of the bar.\\n*   **Interactive Legend:** A vertical legend on the right-hand side clarifies the color coding for each rank.\\n*   **Detailed Tooltip:** Hovering over a segment of a bar shows the source, rank, and the number of conferences in a tooltip.\\n\\n**Data Source and Filtering:**\\n\\nThe data is filtered to include only the 'CORE2023' and 'CORE2021' sources and only conferences with ranks A, B, or C. The query groups the data by source and rank, and then counts the conferences within each group.\"\n}" },
    { text: "input: User question 1: Show a bar chart of conference counts by country.\nUser question 2: Change the X-axis to show conference counts by year instead.\nUser question 3: Add the title \"Conferences per Year Trend\"." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conferences per Year Trend\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Year\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"rotate\": 45,\n        \"fontSize\": 12\n      },\n      \"boundaryGap\": true\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Number of Conferences\",\n        \"type\": \"bar\",\n        \"itemStyle\": {\n          \"color\": \"#2f4f4f\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"top\",\n          \"fontSize\": 12\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"shadow\"\n      }\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"4%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Year\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" GROUP BY \\\"Year\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis bar chart displays the trend of the number of conferences over different years.  Each bar represents a specific year, and the height of the bar indicates the total number of conferences held in that year. The x-axis is labeled *\\\"Year\\\"*, and the y-axis represents the *\\\"Number of Conferences\\\"*.  The chart title is *\\\"Conferences per Year Trend\\\"*.\\n\\n**Key Features:**\\n\\n*   **Yearly Trend:** The chart allows for a clear visualization of how the number of conferences has changed over time.\\n*   **Bar Representation:**  Each year is represented by a bar, with the bar's height directly proportional to the conference count for that year.\\n*   **Value Labels:** The exact *number of conferences* for each year is displayed *above* each bar.\\n*  **Emphasis on Hover:** When you hover a bar, the bar is highlighted.\\n*   **Interactive Tooltip:**  Hovering over a bar reveals the year and the number of conferences in a tooltip, which also includes a shadow effect for the axis pointer.\\n*   **Rotated X-axis Labels:** Year labels on the x-axis are *rotated 45 degrees* for better readability.\\n*   **Boundary Gap:**  The bars are positioned with a gap between the axis and the first bar, enhancing visual clarity.\\n\\n**Data Source:**\\n\\nThe data is sourced from the database by grouping and counting the number of conferences for each year.\"\n}" },
    { text: "input: User question 1: Show me a bar chart of conferences by Rank.\nUser question 2: Filter to only include conferences in Europe.\nUser question 3: Further filter to only show conferences in the year 2024 and 2025." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conferences by Rank in Europe (2024 and 2025)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Rank\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Number of Conferences\",\n        \"type\": \"bar\",\n        \"itemStyle\": {\n          \"color\": \"#800080\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"top\",\n          \"fontSize\": 12\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"shadow\"\n      }\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"4%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Rank\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Continent\\\" = 'Europe' AND \\\"Year\\\" IN ('2024','2025') GROUP BY \\\"Rank\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis bar chart displays the number of conferences for each rank in Europe, specifically for the years 2024 and 2025.  Each bar represents a conference rank, and the height of the bar indicates the total number of conferences of that rank. The x-axis shows different *\\\"Ranks\\\"*, and the y-axis represents the *\\\"Number of Conferences\\\"*.  The chart is titled *\\\"Conferences by Rank in Europe (2024 and 2025)\\\"*.\\n\\n**Key Features:**\\n\\n*   **Rank Comparison:** The chart facilitates a direct comparison of the number of conferences across different ranks.\\n*   **Bar Representation:** Each conference rank is represented by a bar, with the bar's height directly proportional to the number of conferences of that rank.\\n*   **Value Labels:** The exact *number of conferences* for each rank is displayed *above* each bar.\\n* **Emphasis on Hover:** Each bar gets highlighted when you hover.\\n*   **Interactive Tooltip:** Hovering over a bar shows the rank and the number of conferences in a tooltip. The tooltip uses a shadow effect for the axis pointer.\\n\\n**Data Source and Filtering:**\\n\\nThe data is filtered to include only conferences in **Europe** and only for the years **2024 and 2025**. The data is then grouped by rank and the number of conferences for each rank is counted.\"\n}" },
    { text: "input: User question 1: Create a stacked bar chart showing conference types breakdown.\nUser question 2: Group the bars by Continent.\nUser question 3: Only include conferences of Rank A*." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Type Breakdown per Continent (Rank A*)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Continent\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"rotate\": 45,\n        \"fontSize\": 12\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"legend\": {\n      \"orient\": \"vertical\",\n      \"right\": 10,\n      \"top\": \"middle\",\n      \"itemGap\": 10,\n      \"textStyle\": {\n        \"fontSize\": 14\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Offline\",\n        \"type\": \"bar\",\n        \"stack\": \"type\",\n        \"itemStyle\": {\n          \"color\": \"#4c8daf\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"inside\",\n          \"formatter\": \"{c}\",\n          \"fontSize\": 10\n        }\n      },\n      {\n        \"name\": \"Online\",\n        \"type\": \"bar\",\n        \"stack\": \"type\",\n        \"itemStyle\": {\n          \"color\": \"#c23531\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"inside\",\n          \"formatter\": \"{c}\",\n          \"fontSize\": 10\n        }\n      },\n      {\n        \"name\": \"Hybrid\",\n        \"type\": \"bar\",\n        \"stack\": \"type\",\n        \"itemStyle\": {\n          \"color\": \"#2f4554\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"inside\",\n          \"formatter\": \"{c}\",\n          \"fontSize\": 10\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"shadow\"\n      },\n      \"formatter\": \"{a} {b}: {c}\"\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"15%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Continent\\\", \\\"Type\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Rank\\\" = 'A*' GROUP BY \\\"Continent\\\", \\\"Type\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis stacked bar chart presents a breakdown of conference types (Offline, Online, Hybrid) for each continent, specifically focusing on conferences with a rank of **A\\***.  Each bar represents a continent, and the bar is divided into segments representing the number of Offline, Online, and Hybrid conferences within that continent and rank. The chart title is *\\\"Conference Type Breakdown per Continent (Rank A*)\\\"*. The x-axis represents *\\\"Continent\\\"* and the y-axis is *\\\"Number of Conferences\\\"*. X-axis labels are rotated.\\n\\n**Key Features:**\\n\\n*   **Stacked Bars:**  Each bar is stacked to show the proportion of Offline (blue), Online (red), and Hybrid (dark gray) conferences within each continent.\\n*   **Conference Type Breakdown:** The chart allows for a direct comparison of the prevalence of different conference types (Offline, Online, Hybrid) across various continents.\\n*   **Rank A\\* Focus:**  The data is filtered to include *only* conferences with a rank of A\\*, providing a view of high-quality conferences.\\n*   **Value Labels:** The *number* of conferences for each type is displayed *inside* each segment of the bar.\\n*   **Interactive Legend:**  A vertical legend on the right side clarifies the color coding for each conference type (Offline, Online, Hybrid).\\n*   **Detailed Tooltip:** Hovering over a segment of a bar displays the continent, conference type, and the number of conferences in a tooltip.\\n\\n**Data Source and Filtering:**\\n\\nThe data is filtered to include only conferences with a rank of **A\\***. The query then groups the data by continent and conference type, counting the number of conferences in each group.\"\n}" },
    { text: "input: User question 1: Create a line chart showing the number of conferences per Source.\nUser question 2: Compare conferences of Ranks on the same chart." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Trend of Ranks over Source\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Source\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": false\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"A*\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#e41a1c\"\n        },\n        \"areaStyle\": {}\n      },\n      {\n        \"name\": \"A\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#377eb8\"\n        },\n        \"areaStyle\": {}\n      },\n      {\n        \"name\": \"B\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#4daf4a\"\n        },\n        \"areaStyle\": {}\n      },\n      {\n        \"name\": \"C\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#984ea3\"\n        },\n        \"areaStyle\": {}\n      },\n      {\n        \"name\": \"National\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#ff7f00\"\n        },\n        \"areaStyle\": {}\n      },\n      {\n        \"name\": \"Regional\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#a65628\"\n        },\n        \"areaStyle\": {}\n      },\n      {\n        \"name\": \"Unranked\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#f781bf\"\n        },\n        \"areaStyle\": {}\n      }\n    ],\n    \"legend\": {\n      \"left\": 60,\n      \"top\": 50,\n      \"orient\": \"horizontal\",\n      \"textStyle\": {\n        \"fontSize\": 14\n      },\n      \"itemWidth\": 15,\n      \"itemHeight\": 10\n    },\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"cross\"\n      }\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"4%\",\n      \"bottom\": \"15%\",\n      \"top\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Source\\\", \\\"Rank\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" GROUP BY \\\"Source\\\", \\\"Rank\\\" ORDER BY \\\"Source\\\" ASC\",\n  \"Description\": \"**Overview:**\\n\\nThis line chart displays the trend in the number of conferences for different ranks across various sources.  Each line represents a specific conference rank (A\\*, A, B, C, National, Regional, Unranked), allowing for a direct comparison of how the number of conferences of each rank changes across different sources.  The chart is titled *\\\"Conference Trend of Ranks over Source\\\"*. The x-axis is *\\\"Source\\\"*, and the y-axis represents the *\\\"Number of Conferences\\\"*.\\n\\n**Key Features:**\\n\\n*   **Multiple Lines:** Seven different lines represent the various conference ranks, each with a distinct color.\\n*   **Smooth Lines:**  The lines are smoothed, providing a more visually appealing and easier-to-interpret representation of the trends.\\n* **Area Style**: The area below each line is filled.\\n*   **Interactive Legend:** A horizontal legend at the top left identifies each rank and its corresponding line color. The legend is made compact to conserve spaces\\n*   **Detailed Tooltip:**  Hovering over any point on a line displays the source, rank, and the exact number of conferences.  The tooltip also includes crosshair lines to precisely pinpoint the x and y values.\\n\\n**Data Source:**\\n\\nThe data is obtained by grouping the conference data by both source and rank, and then counting the number of conferences within each group. The results are ordered by source.\"\n}" },
    { text: "input: User question 1: Show me a line chart of average conference rating over years.\nUser question 2: Compare the trend for Rank A and Rank B conferences.\nUser question 3: Limit the years to 2024 and 2025." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Rating Trend for Rank A and B (2024-2025)\",\n      \"left\": \"center\"\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Year\"\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Average Conference Rating\"\n    },\n    \"series\": [\n      {\n        \"name\": \"A\",\n        \"type\": \"line\",\n        \"smooth\": true\n      },\n      {\n        \"name\": \"B\",\n        \"type\": \"line\",\n        \"smooth\": true\n      }\n    ],\n    \"legend\": {\n      \"left\": \"left\"\n    },\n    \"tooltip\": {\n      \"trigger\": \"axis\"\n    }\n  },\n  \"PostgresSQL\": \"SELECT \\\"Year\\\", \\\"Rank\\\", ROUND(AVG(\\\"Rating\\\"), 1) AS \\\"Average Rating\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Rank\\\" IN ('A', 'B') AND \\\"Year\\\" IN ('2024', '2025') GROUP BY \\\"Year\\\", \\\"Rank\\\" ORDER BY \\\"Year\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis line chart displays the trend of average conference ratings over the years 2024 and 2025, specifically comparing the trends for conferences ranked **A** and **B**. Each line represents a rank (A or B). The x-axis represents the *\\\"Year\\\"*, and the y-axis represents the *\\\"Average Conference Rating\\\"*. The title is \\\"Conference Rating Trend for Rank A and B (2024-2025)\\\".\\n\\n**Key Features:**\\n\\n*   **Two Lines for Comparison:** The chart uses two lines to directly compare the average rating trends of Rank A and Rank B conferences.\\n*   **Smooth Lines:** The lines are smoothed for better visual representation of the trends.\\n*   **Interactive Legend:** A legend on the left side identifies which line corresponds to which rank (A or B).\\n*   **Detailed Tooltip:** Hovering over any point on the lines displays the year, rank, and the average conference rating for that specific point.\\n\\n**Data Source and Filtering:**\\n\\nThe data is filtered to include *only* conferences with ranks **A** and **B**, and *only* for the years **2024 and 2025**. The average rating is calculated for each rank within each year, and the result is rounded to one decimal place.\"\n}" },
    { text: "input: User question 1: Draw a line chart of average conference rating over years.\nUser question 2: Make the line dashed.\nUser question 3: Fill the area under the line with a gradient color." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Average Conference Rating Trend over Years\",\n      \"left\": \"center\"\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Year\"\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Average Rating\"\n    },\n    \"series\": [\n      {\n        \"name\": \"Average Rating\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\"\n        },\n        \"areaStyle\": {\n          \"color\": {\n            \"type\": \"linear\",\n            \"x\": 0,\n            \"y\": 0,\n            \"x2\": 0,\n            \"y2\": 1,\n            \"colorStops\": [\n              {\n                \"offset\": 0,\n                \"color\": \"rgba(0, 136, 212, 0.7)\"\n              },\n              {\n                \"offset\": 1,\n                \"color\": \"rgba(0, 136, 212, 0.0)\"\n              }\n            ],\n            \"global\": false\n          }\n        }\n      }\n    ],\n    \"legend\": {\n      \"left\": \"left\"\n    },\n    \"tooltip\": {\n      \"trigger\": \"axis\"\n    }\n  },\n  \"PostgresSQL\": \"SELECT \\\"Year\\\", ROUND(AVG(\\\"Rating\\\"), 1) AS \\\"Average Rating\\\" FROM public.\\\"Visualize\\\" GROUP BY \\\"Year\\\" ORDER BY \\\"Year\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis line chart displays the trend of average conference ratings over the years.  The x-axis represents the *\\\"Year\\\"*, and the y-axis shows the *\\\"Average Rating\\\"*. The chart has the title *\\\"Average Conference Rating Trend over Years\\\"*. The line itself is *dashed*, and the area under the line is filled with a *gradient color*.\\n\\n**Key Features:**\\n\\n*   **Trend Visualization:** The chart effectively shows how the average conference rating has changed over time.\\n*   **Dashed Line:** The line is rendered as a *dashed line*, providing a distinct visual style.\\n*   **Gradient Area Fill:** The area *under* the line is filled with a *vertical gradient*, transitioning from a semi-transparent blue (rgba(0, 136, 212, 0.7)) at the top to fully transparent (rgba(0, 136, 212, 0.0)) at the bottom. This adds visual emphasis to the trend.\\n* **Smooth Line**: The line is smoothed.\\n*   **Interactive Legend:**  A legend on the left side indicates that the line represents the \\\"Average Rating\\\".\\n*   **Detailed Tooltip:** Hovering over any point on the line displays the year and the corresponding average conference rating.\\n\\n**Data Source:**\\n\\nThe data is obtained by calculating the average conference rating for each year.  The average rating is rounded to one decimal place.\"\n}" },
    { text: "input: User question 1: Show me a line chart of average conference rating over Source.\nUser question 2: Compare the average rating of conferences VLDB and SIGGRAPH.\nUser question 3: Limit the source to CORE2023 and CORE2021." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Average Conference Rating Trend for VLDB and SIGGRAPH (CORE2023 - CORE2021)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Source\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"boundaryGap\": false\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Average Rating\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"VLDB\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#2980b9\"\n        },\n        \"areaStyle\": {}\n      },\n      {\n        \"name\": \"SIGGRAPH\",\n        \"type\": \"line\",\n        \"smooth\": true,\n        \"itemStyle\": {\n          \"color\": \"#c0392b\"\n        },\n        \"areaStyle\": {}\n      }\n    ],\n    \"legend\": {\n      \"left\": \"left\",\n      \"top\": \"middle\",\n      \"orient\": \"vertical\",\n      \"textStyle\": {\n        \"fontSize\": 14\n      }\n    },\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"cross\"\n      }\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"4%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Source\\\", ROUND(AVG(\\\"Rating\\\"), 1) AS \\\"Average Rating\\\", \\\"Acronym\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Source\\\" IN ('CORE2023', 'CORE2021') AND \\\"Acronym\\\" IN ('VLDB', 'SIGGRAPH') GROUP BY \\\"Source\\\", \\\"Acronym\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis line chart compares the average conference rating trends for VLDB and SIGGRAPH conferences, specifically within the CORE2023 and CORE2021 sources.  Each line represents one of the conferences (VLDB or SIGGRAPH). The x-axis represents the *\\\"Source\\\"*, and the y-axis displays the *\\\"Average Rating\\\"*. The chart title is *\\\"Average Conference Rating Trend for VLDB and SIGGRAPH (CORE2023 - CORE2021)\\\"*. The line representing the VLDB data is blue, and the line representing the SIGGRAPH data is red.\\n\\n**Key Features:**\\n\\n*   **Two-Line Comparison:**  Two lines are used to directly compare the average rating trends of VLDB and SIGGRAPH conferences across the selected sources.\\n*   **Smooth Lines:** The lines are smoothed, providing a more visually appealing representation of the trends.\\n*   **Area Style:** The area below each line is filled.\\n*   **Interactive Legend:** A vertical legend on the left side identifies which line corresponds to which conference (VLDB or SIGGRAPH).\\n*   **Detailed Tooltip:** Hovering over any point on the lines displays the source, conference acronym, and the average rating for that point.  The tooltip also includes crosshair lines for precise value identification.\\n*   **Boundary Gap:** The `boundaryGap: false` setting on the x-axis ensures that the lines extend to the edges of the chart.\\n\\n**Data Source and Filtering:**\\n\\nThe data is filtered to include only the **CORE2023 and CORE2021** sources and only the **VLDB and SIGGRAPH** conferences.  The average rating is calculated for each conference within each source, and the result is rounded to one decimal place.\"\n}" },
    { text: "input: User question 1: How has conference publishing activity changed over the years?\nUser question 2: Can we see which sources contribute to this trend?\nUser question 3: Show me a visual to see the amount of contribution per source each year?" },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Activity by Year and Source\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"tooltip\": {\n      \"position\": \"top\"\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Year\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"splitArea\": {\n        \"show\": true\n      },\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"axisTick\": {\n        \"show\": false\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Source\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 80,\n      \"splitArea\": {\n        \"show\": true\n      },\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"axisTick\": {\n        \"show\": false\n      }\n    },\n    \"visualMap\": {\n      \"min\": 0,\n      \"max\": 30,\n      \"calculable\": true,\n      \"orient\": \"horizontal\",\n      \"left\": \"center\",\n      \"bottom\": \"1%\",\n      \"inRange\": {\n        \"color\": [\n          \"#313695\",\n          \"#4575b4\",\n          \"#74add1\",\n          \"#abd9e9\",\n          \"#e0f3f8\",\n          \"#ffffbf\",\n          \"#fee090\",\n          \"#fdae61\",\n          \"#f46d43\",\n          \"#d73027\",\n          \"#a50026\"\n        ]\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Number of Conferences\",\n        \"type\": \"heatmap\",\n        \"label\": {\n          \"show\": true,\n          \"fontSize\": 12\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"grid\": [\n      {\n        \"left\": \"10%\",\n        \"right\": \"10%\",\n        \"top\": \"10%\",\n        \"bottom\": \"20%\"\n      }\n    ]\n  },\n  \"PostgresSQL\": \"SELECT \\\"Year\\\", \\\"Source\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" GROUP BY \\\"Year\\\", \\\"Source\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis heatmap visualizes conference activity over different years and sources.  Each cell in the heatmap represents the number of conferences for a specific year and source.  The color of the cell indicates the number of conferences, with darker colors representing a higher number of conferences and lighter colors representing fewer. The chart title is *\\\"Conference Activity by Year and Source\\\"*. The x-axis is *\\\"Year\\\"*, and the y-axis is *\\\"Source\\\"*.\\n\\n**Key Features:**\\n\\n*   **Heatmap Representation:** The chart uses a heatmap to display the data, where color intensity directly corresponds to the number of conferences.\\n*   **Year and Source:** The x-axis represents the year, and the y-axis represents the source of the conference data.\\n*   **Color Scale (Visual Map):**  A visual map (color scale) at the bottom of the chart shows the range of conference counts (from 0 to 30 in this case) and the corresponding colors.  The color scale ranges from dark blue (low values) to dark red (high values), with various shades in between.\\n*   **Value Labels:** The *exact number* of conferences for each year and source is displayed *inside* each cell of the heatmap.\\n* **Emphasis on Hover** Each cell is highlighted when you hover.\\n*   **Interactive Tooltip:** Hovering over a cell shows the year, source, and number of conferences. The tooltip will appear on the top of a cell.\\n*   **Split Areas:**  Both the x-axis (Year) and y-axis (Source) have split areas, visually separating the different years and sources.\\n* **X-axis and Y-axis tick are not show**: This makes the chart cleaner.\\n\\n**Data Source:**\\n\\nThe data is obtained by grouping the conference data by year and source and then counting the number of conferences within each group.\"\n}" },
    { text: "input: User question 1: Show a pie chart of conference rank distribution.\nUser question 2: Filter for conferences related to 'Artificial Intelligence'.\nUser question 3: Further filter to conferences from the CORE2023 source." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Rank Distribution in Artificial Intelligence (CORE2023)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"tooltip\": {\n      \"trigger\": \"item\",\n      \"formatter\": \"{a} {b}: {c} ({d}%)\"\n    },\n    \"legend\": {\n      \"orient\": \"vertical\",\n      \"left\": \"left\",\n      \"top\": \"middle\",\n      \"itemGap\": 10,\n      \"textStyle\": {\n        \"fontSize\": 14\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Conference Rank\",\n        \"type\": \"pie\",\n        \"radius\": [\n          \"40%\",\n          \"70%\"\n        ],\n        \"center\": [\n          \"55%\",\n          \"50%\"\n        ],\n        \"avoidLabelOverlap\": true,\n        \"label\": {\n          \"show\": true,\n          \"position\": \"outside\",\n          \"formatter\": \"{b}: {d}%\",\n          \"fontSize\": 12\n        },\n        \"labelLine\": {\n          \"show\": true,\n          \"length\": 10,\n          \"length2\": 15\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"backgroundColor\": \"#f5f5f5\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Rank\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Topics\\\" ILIKE '%artificial intelligence%' AND \\\"Source\\\" = 'CORE2023' GROUP BY \\\"Rank\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis pie chart displays the distribution of conference ranks for conferences related to *Artificial Intelligence* and sourced from *CORE2023*. Each slice of the pie represents a different conference rank, and the size of the slice is proportional to the number of conferences of that rank. The chart uses a donut shape (inner radius 40%, outer radius 70%).  The chart title is *\\\"Conference Rank Distribution in Artificial Intelligence (CORE2023)\\\"*.\\n\\n**Key Features:**\\n\\n*   **Rank Distribution:** The chart clearly shows the proportion of conferences of each rank within the specified filters (Artificial Intelligence, CORE2023).\\n*   **Proportional Representation:**  The size of each slice directly corresponds to the number of conferences of that rank.\\n*   **Percentage Labels:**  Each slice has a label outside the pie, displaying the *percentage* of conferences belonging to that rank.\\n*   **Interactive Legend:**  A vertical legend on the left-hand side lists the different conference ranks.\\n* **Emphasis on Hover:** When you hover a slice, the slice is highlighted.\\n*   **Detailed Tooltip:**  Hovering over a slice reveals the *exact number* of conferences of that rank, along with the rank name and percentage.\\n\\n**Data Source and Filtering:**\\n\\nThe data is filtered to include only conferences related to **Artificial Intelligence** (using a case-insensitive search on the 'Topics' field) and sourced from **CORE2023**.  The data is then grouped by rank, and the number of conferences for each rank is counted.\"\n}" },
    { text: "input: User question 1: Show the average rating of conferences in a bar chart.\nUser question 2: Compare the conferences published by Springer, IEEE and ACM.\nUser question 3: Only include conferences from the CORE2023 source and Rank A, B and C." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Average Conference Rating\",\n      \"subtext\": \"Springer, IEEE, and ACM (CORE2023, Ranks A, B, C)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 22,\n        \"fontWeight\": \"bold\"\n      },\n      \"subtextStyle\": {\n        \"fontSize\": 16,\n        \"color\": \"#555\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Publisher\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"fontSize\": 14,\n        \"fontWeight\": \"bold\"\n      },\n      \"axisTick\": {\n        \"show\": false\n      },\n      \"axisLine\": {\n        \"show\": false\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Average Rating\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 14\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ccc\"\n        }\n      },\n      \"axisTick\": {\n        \"show\": false\n      },\n      \"axisLine\": {\n        \"show\": false\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Average Rating\",\n        \"type\": \"bar\",\n        \"itemStyle\": {\n          \"color\": \"#2ecc71\",\n          \"borderRadius\": [\n            5,\n            5,\n            0,\n            0\n          ]\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"top\",\n          \"fontSize\": 14,\n          \"fontWeight\": \"bold\",\n          \"color\": \"#333\"\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"shadow\"\n      },\n      \"backgroundColor\": \"rgba(0,0,0,0.7)\",\n      \"textStyle\": {\n        \"color\": \"#fff\"\n      },\n      \"formatter\": \"{b}: {c}\"\n    },\n    \"grid\": {\n      \"left\": \"12%\",\n      \"right\": \"8%\",\n      \"bottom\": \"15%\",\n      \"top\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f0f0f0\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Publisher\\\", ROUND(AVG(\\\"Rating\\\"), 1) AS \\\"AverageRating\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Source\\\" = 'CORE2023' AND \\\"Rank\\\" IN ('A', 'B', 'C') AND (\\\"Publisher\\\" ILIKE '%springer%' OR \\\"Publisher\\\" ILIKE '%ieee%' OR \\\"Publisher\\\" ILIKE '%acm%') GROUP BY \\\"Publisher\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis bar chart compares the average conference ratings for conferences published by Springer, IEEE, and ACM.  The data is filtered to include only conferences from the CORE2023 source and with ranks A, B, or C. Each bar represents one of the publishers.  The x-axis is *\\\"Publisher\\\"*, and the y-axis represents the *\\\"Average Rating\\\"*. The main title is *\\\"Average Conference Rating\\\"*, and the subtitle specifies the included publishers, source, and ranks: \\\"Springer, IEEE, and ACM (CORE2023, Ranks A, B, C)\\\".\\n\\n**Key Features:**\\n\\n*   **Publisher Comparison:** The chart allows for a direct comparison of the average conference ratings across the three publishers.\\n*   **Rounded Bars:** The bars have rounded corners at the top (`borderRadius: [5, 5, 0, 0]`).\\n*   **Value Labels:** The *average rating* is displayed *above* each bar, using a *bold* font.\\n*   **Clean Axis Design:** The x-axis and y-axis lines and ticks are hidden for a cleaner visual appearance.\\n*  **Emphasis on Hover:** When you hover a bar, a shadow is displayed.\\n*   **Informative Tooltip:** Hovering over a bar reveals the publisher and their average rating in a tooltip with a dark background and white text.\\n*   **Dashed Grid Lines:** Dashed grid lines on the y-axis help to easily read the average rating.\\n\\n**Data Source and Filtering:**\\n\\nThe data is filtered to include only conferences from the **CORE2023** source and with ranks **A, B, and C**. The publishers included are **Springer, IEEE, and ACM** (identified using a case-insensitive search on the 'Publisher' field). The average rating is calculated for each publisher, and the result is rounded to one decimal place.\"\n}" },
    { text: "input: User question 1: Show a pie chart of conference rank distribution.\nUser question 2: Only for conferences in France.\nUser question 3: Further filter to conferences from the CORE2023 source." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conference Rank Distribution in France (CORE2023)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 22,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"tooltip\": {\n      \"trigger\": \"item\",\n      \"formatter\": \"{a} {b}: {c} ({d}%)\",\n      \"backgroundColor\": \"rgba(0,0,0,0.7)\",\n      \"textStyle\": {\n        \"color\": \"#fff\"\n      }\n    },\n    \"legend\": {\n      \"orient\": \"vertical\",\n      \"left\": \"left\",\n      \"top\": \"middle\",\n      \"itemGap\": 10,\n      \"textStyle\": {\n        \"fontSize\": 14\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Conference Rank\",\n        \"type\": \"pie\",\n        \"radius\": [\n          \"40%\",\n          \"70%\"\n        ],\n        \"center\": [\n          \"55%\",\n          \"50%\"\n        ],\n        \"avoidLabelOverlap\": true,\n        \"label\": {\n          \"show\": true,\n          \"position\": \"outside\",\n          \"formatter\": \"{b}: {d}%\",\n          \"fontSize\": 14\n        },\n        \"labelLine\": {\n          \"show\": true,\n          \"length\": 15,\n          \"length2\": 20\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 15,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.7)\"\n          }\n        }\n      }\n    ],\n    \"backgroundColor\": \"#ecf0f1\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Rank\\\", COUNT(*) AS \\\"NumOfConferences\\\"\\nFROM public.\\\"Visualize\\\"\\nWHERE \\\"Country\\\" = 'France' AND \\\"Source\\\" = 'CORE2023'\\nGROUP BY \\\"Rank\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis pie chart displays the distribution of conference ranks in France, specifically for conferences from the CORE2023 source.  Each slice of the pie represents a different conference rank, and the size of the slice is proportional to the number of conferences of that rank.  The chart uses a donut shape (inner radius 40%, outer radius 70%). The chart title is *\\\"Conference Rank Distribution in France (CORE2023)\\\"*. \\n\\n**Key Features:**\\n\\n*   **Rank Distribution:** The chart clearly illustrates the proportions of conferences for each rank within France, as reported in CORE2023.\\n*   **Proportional Slice Sizes:**  The size of each slice directly corresponds to the number of conferences of that particular rank.\\n*   **Percentage Labels:** Each slice is labeled with the *percentage* of conferences belonging to that rank, positioned *outside* the pie.\\n*   **Interactive Legend:**  A vertical legend on the left side identifies each conference rank.\\n* **Emphasis on Hover:** Each slice gets highlighted with a shadow when you hover.\\n*   **Detailed Tooltip:**  Hovering over a slice displays the rank and the number of conferences, in tooltip has a dark background and white text.\\n\\n**Data Source and Filtering:**\\n\\nThe data includes only conferences held in **France** and sourced from **CORE2023**. The SQL query groups the data by conference rank and counts the number of conferences within each rank.\"\n}" },
    { text: "input: User question 1: Show a bar chart of conference counts by country.\nUser question 2: Filter for conferences related to the topic 'Data Mining'.\nUser question 3: Limit the conferences to the year 2025." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conferences by Country (Data Mining, 2025)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Country\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"rotate\": 45,\n        \"fontSize\": 12\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Number of Conferences\",\n        \"type\": \"bar\",\n        \"itemStyle\": {\n          \"color\": \"#4c8daf\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"top\",\n          \"fontSize\": 12\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"shadow\"\n      }\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"4%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Country\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Topics\\\" ILIKE '%data mining%' AND \\\"Year\\\" = '2025' GROUP BY \\\"Country\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis bar chart displays the number of conferences by country for conferences related to the topic of 'Data Mining' and limited to the year 2025. Each bar represents a country. The x-axis represents the *\\\"Country\\\"*, and the y-axis represents the *\\\"Number of Conferences\\\"*. The chart title is *\\\"Conferences by Country (Data Mining, 2025)\\\"*. X-axis labels are rotated.\\n\\n**Key Features:**\\n\\n*   **Country Comparison:** The chart allows for a direct comparison of the number of conferences related to Data Mining held in different countries in 2025.\\n*   **Bar Representation:** Each country is represented by a bar, and the height of the bar is proportional to the number of conferences.\\n*   **Value Labels:** The *exact number* of conferences for each country is displayed *above* each bar.\\n* **Emphasis on Hover:** Each bar gets highlighted with a shadow when you hover.\\n*   **Interactive Tooltip:** Hovering over a bar reveals the country and the number of conferences, a tooltip with a shadow effect for the axis pointer.\\n*   **Rotated X-Axis Labels:** The country names on the x-axis are rotated for better readability.\\n\\n**Data Source and Filtering:**\\n\\nThe data is filtered to include only conferences related to *'Data Mining'* (using a case-insensitive search on the 'Topics' field) and only for the year *2025*. The query groups the data by country and counts the number of conferences for each country.\"\n}" },
    { text: "input: User question 1: Show a heatmap of average conference rating.\nUser question 2: Show the relationship between country and publisher.\nUser question 3: Limit the conferences to the year 2025 and Rank A or B" },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Conferences by Country (Data Mining, 2025)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 20,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Country\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"rotate\": 45,\n        \"fontSize\": 12\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Number of Conferences\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      }\n    },\n    \"series\": [\n      {\n        \"name\": \"Number of Conferences\",\n        \"type\": \"bar\",\n        \"itemStyle\": {\n          \"color\": \"#4c8daf\"\n        },\n        \"label\": {\n          \"show\": true,\n          \"position\": \"top\",\n          \"fontSize\": 12\n        },\n        \"emphasis\": {\n          \"itemStyle\": {\n            \"shadowBlur\": 10,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.5)\"\n          }\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"axis\",\n      \"axisPointer\": {\n        \"type\": \"shadow\"\n      }\n    },\n    \"grid\": {\n      \"left\": \"10%\",\n      \"right\": \"4%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"backgroundColor\": \"#f8f8f8\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Country\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" WHERE \\\"Topics\\\" ILIKE '%data mining%' AND \\\"Year\\\" = '2025' GROUP BY \\\"Country\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis bar chart displays the number of conferences by country for conferences related to the topic of 'Data Mining' and limited to the year 2025. Each bar represents a country. The x-axis represents the *\\\"Country\\\"*, and the y-axis represents the *\\\"Number of Conferences\\\"*. The chart title is *\\\"Conferences by Country (Data Mining, 2025)\\\"*. X-axis labels are rotated.\\n\\n**Key Features:**\\n\\n*   **Country Comparison:** The chart allows for a direct comparison of the number of conferences related to Data Mining held in different countries in 2025.\\n*   **Bar Representation:** Each country is represented by a bar, and the height of the bar is proportional to the number of conferences.\\n*   **Value Labels:** The *exact number* of conferences for each country is displayed *above* each bar.\\n* **Emphasis on Hover:** Each bar gets highlighted with a shadow when you hover.\\n*   **Interactive Tooltip:** Hovering over a bar reveals the country and the number of conferences, a tooltip with a shadow effect for the axis pointer.\\n*   **Rotated X-Axis Labels:** The country names on the x-axis are rotated for better readability.\\n\\n**Data Source and Filtering:**\\n\\nThe data is filtered to include only conferences related to *'Data Mining'* (using a case-insensitive search on the 'Topics' field) and only for the year *2025*. The query groups the data by country and counts the number of conferences for each country.\"\n}" },
    { text: "input: User question 1: Create a scatter chart showing the relationship between continent and average rating.\nUser question 2: Scale the size of the data points based on the number of conferences of each continent." },
    { text: "output: {\n  \"Echarts\": {\n    \"title\": {\n      \"text\": \"Continent vs. Average Rating (Scaled by Conference Count)\",\n      \"left\": \"center\",\n      \"textStyle\": {\n        \"fontSize\": 22,\n        \"fontWeight\": \"bold\"\n      }\n    },\n    \"xAxis\": {\n      \"type\": \"category\",\n      \"name\": \"Continent\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 30,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": false\n      }\n    },\n    \"yAxis\": {\n      \"type\": \"value\",\n      \"name\": \"Average Rating\",\n      \"nameLocation\": \"middle\",\n      \"nameGap\": 40,\n      \"axisLabel\": {\n        \"fontSize\": 12\n      },\n      \"splitLine\": {\n        \"show\": true,\n        \"lineStyle\": {\n          \"type\": \"dashed\",\n          \"color\": \"#ddd\"\n        }\n      },\n      \"scale\": true\n    },\n    \"series\": [\n      {\n        \"name\": \"Number of conferences\",\n        \"type\": \"scatter\",\n        \"symbolSize\": \"function (val) { return val[2]; }\",\n        \"emphasis\": {\n          \"focus\": \"series\",\n          \"itemStyle\": {\n            \"shadowBlur\": 12,\n            \"shadowOffsetX\": 0,\n            \"shadowColor\": \"rgba(0, 0, 0, 0.6)\"\n          }\n        },\n        \"itemStyle\": {\n          \"color\": \"#3498db\"\n        }\n      }\n    ],\n    \"tooltip\": {\n      \"trigger\": \"item\",\n      \"formatter\": \"Continent: {b}Average Rating: {c}Conference Count: {d}\",\n      \"backgroundColor\": \"rgba(0,0,0,0.7)\",\n      \"textStyle\": {\n        \"color\": \"#fff\"\n      }\n    },\n    \"grid\": {\n      \"left\": \"12%\",\n      \"right\": \"8%\",\n      \"bottom\": \"15%\",\n      \"containLabel\": true\n    },\n    \"visualMap\": {\n      \"type\": \"continuous\",\n      \"min\": 0,\n      \"max\": 100,\n      \"calculable\": true,\n      \"text\": [\n        \"High Conference Count\",\n        \"Low Conference Count\"\n      ],\n      \"inRange\": {\n        \"color\": [\n          \"#e0ffff\",\n          \"#3498db\"\n        ]\n      }\n    },\n    \"backgroundColor\": \"#ecf0f1\"\n  },\n  \"PostgresSQL\": \"SELECT \\\"Continent\\\", ROUND(AVG(\\\"Rating\\\"), 1) AS \\\"AverageRating\\\", COUNT(*) AS \\\"NumOfConferences\\\" FROM public.\\\"Visualize\\\" GROUP BY \\\"Continent\\\"\",\n  \"Description\": \"**Overview:**\\n\\nThis scatter chart displays the relationship between continent and average conference rating.  The size of each data point (circle) is scaled based on the number of conferences originating from that continent.  The x-axis represents the *\\\"Continent\\\"*, and the y-axis represents the *\\\"Average Rating\\\"*. The chart title is *\\\"Continent vs. Average Rating (Scaled by Conference Count)\\\"*. The series focuses when you hover.\\n\\n**Key Features:**\\n\\n*   **Scatter Plot Visualization:** The chart uses a scatter plot to show the relationship between two continuous variables: continent and average rating.\\n*   **Scaled Symbol Size:** The size of each circle is proportional to the *number of conferences* from that continent. Continents with a large number of conferences are represented by larger circles, while continents with fewer conferences are represented by smaller circles. This allows you to visually assess the level of activity alongside the average rating.\\n*   **Interactive Tooltip:**  Hovering over a data point displays the continent, average rating, and conference count in a tooltip.\\n*   **Data range**: The chart's color also indicates the data range for number of conference.\\n*   **Color Scale:** The color varies depends on number of conferences and can be understood by the scale at the bottom.\\n*   **Y-Axis Scaling:** The y-axis is scaled to better represent the range of average ratings (scale:true).\\n\\n**Data Source:**\\n\\nThe data is obtained by grouping the conference data by continent, calculating the average rating for each continent, and counting the number of conferences for each continent.\"\n}" },
    { text: `input: ${chartQuestionsHistory}` },
    { text: "output: " },
  ];

  logToFile(`Calling visualizeService.generateContent with parts: ${JSON.stringify(parts)}`); // Log input to Gemini
  try {
    const responseText = await visualizeService.generateContent(parts, visualizeGenerationConfig, systemInstruction); // Pass config
    logToFile(`Raw response from model (chart): ${responseText}`);
    const parsedResponse = JSON.parse(responseText);
    logToFile(`Parsed response (chart): ${JSON.stringify(parsedResponse)}`);

    if (parsedResponse?.Echarts && parsedResponse?.PostgresSQL && parsedResponse?.Description) {
      const chartData: ChartData = {
        echartsConfig: parsedResponse.Echarts,
        sqlQuery: parsedResponse.PostgresSQL,
        description: parsedResponse.Description
      };

      logToFile(`Chart data: ${JSON.stringify(chartData)}`);
      return { type: 'chart', ...chartData, sqlResult: [] }; // Add thought

    } else {
      logToFile("Incomplete chart data.");
      return { type: 'error', message: 'Failed to generate complete chart data.' };
    }

  } catch (parseError) {
    logToFile(`Error parsing JSON response: ${parseError}`);
    return { type: 'error', message: 'Failed to parse chart data from the model.' };
  }
}

export async function handleWebsiteNavigationIntent(
  userIntent: UserIntent
): Promise<ChatResponse> {
  logToFile(`Handling website navigation intent. User intent: ${JSON.stringify(userIntent)}`); // Log user intent
  if (
    userIntent?.Redirect?.Value &&
    userIntent?.Redirect?.Message &&
    userIntent?.Redirect?.Type
  ) {
    if (userIntent.Redirect.Type === "Internal website") {
      logToFile(`Navigating to internal path: ${userIntent.Redirect.Value}`); // Log internal navigation
      return {
        type: "navigation",
        navigationType: "internal",
        path: userIntent.Redirect.Value,
        message: userIntent.Redirect.Message,
      };
    } else if (userIntent.Redirect.Type === "External website") {
      logToFile(`Navigating to external URL: ${userIntent.Redirect.Value}`); // Log external navigation
      return {
        type: "navigation",
        navigationType: "external",
        url: userIntent.Redirect.Value,
        message: userIntent.Redirect.Message,

      };
    } else {
      logToFile(`Invalid navigation type: ${userIntent.Redirect.Type}`); // Log invalid type
      return {
        type: "error",
        message: "Invalid navigation type.",
      };
    }
  } else {
    logToFile('Incomplete navigation information.'); // Log incomplete info
    return {
      type: "error",
      message: "Incomplete navigation information.",
    };
  }
}

export async function handleNoIntent(): Promise<string> {
  logToFile('Handling no intent.'); // Log no intent
  const greetings = [
    "Hi there!  How can I help you with conferences, journals, or website information?",
    "Hello!  What are you looking for today?",
    "Welcome!  Ask me about conferences, journals, or websites.",
  ];
  const randomIndex = Math.floor(Math.random() * greetings.length);
  const selectedGreeting = greetings[randomIndex];
  logToFile(`Selected greeting: ${selectedGreeting}`); // Log selected greeting
  return selectedGreeting;
}

export async function handleInvalidIntent(
  criteria: Criteria
): Promise<string> {
  logToFile(`Handling invalid intent. Criteria: ${JSON.stringify(criteria)}`); // Log invalid intent
  const response = criteria.Description ||
    "I'm sorry, I didn't understand your request.  Could you rephrase it?";
  logToFile(`Invalid intent response: ${response}`); // Log the response
  return response;
}

async function generateTextResponse(userInput: string, history: HistoryItem[], intent: string, data: string = ""): Promise<ChatResponse> {
  const systemInstruction = getSystemInstruction(intent);

  const textQuestionsHistory: HistoryItem[] = history.filter(entry => (entry.role === 'user' || entry.role === 'model') && entry.type === 'text')
    .map(entry => ({
      role: entry.role,
      parts: [{ text: entry.parts[0].text }]
    }));
  logToFile(`Filtered text history length: ${textQuestionsHistory.length}`);

  if (intent === 'Conference' || intent === 'Journal') {
    textQuestionsHistory.unshift({
      role: 'user',
      parts: [{ text: `**${intent} database:**\n\n${data}` }],
    });
    logToFile(`Added data to history for ${intent}. Data length: ${data.length}`);

  } else if (intent === 'Website') {
    const websiteDescription = process.env.WEBSITE_DESCRIPTION || "No website description available."
    textQuestionsHistory.unshift({
      role: 'user',
      parts: [{ text: `**${intent} description:**\n\n${websiteDescription}` }],
    });
    logToFile(`Added website description to history. Description length: ${websiteDescription.length}`);
  }

  logToFile(`Calling chatbotService.getResponse with userInput: ${userInput}, history length: ${textQuestionsHistory.length}`);
  try {
    const responseText = await chatbotService.getResponse(userInput, textQuestionsHistory, chatbotGenerationConfig, systemInstruction); // Pass config
    logToFile(`Raw response from model (text): ${responseText}`);
    return { type: 'text', message: responseText }; // Add thought
  } catch (error: any) {
    logToFile(`Error generating text response: ${error.message}, Stack: ${error.stack}`); // Log stack trace
    return { type: 'error', message: 'Failed to generate text response.' };
  }

}

// --- Main Handler ---
export async function handleUserInput(
  userInput: string,
  history: HistoryItem[]
): Promise<ChatResponse> {
  logToFile(`User input: ${userInput}`);
  logToFile(`Chat history: ${JSON.stringify(history)}`);

  try {
    const questionList = await extractUserQuestions(history); // Await the promise
    const userIntent: UserIntent | null = await determineUserIntent(questionList.join("\n"));
    logToFile(`Detected user intent: ${JSON.stringify(userIntent)}`);
    const thought = userIntent?.Description || "";

    if (userIntent?.Intent?.includes("Draw chart")) {
      logToFile('Intent: Draw chart');
      const drawChartResult = await handleDrawChartIntent(history, "Chart");
      console.log(thought);
      return { ...drawChartResult, thought: thought };
    } else if (userIntent?.Intent?.includes("Website navigation")) {
      logToFile('Intent: Website navigation');
      const navigationResult = await handleWebsiteNavigationIntent(userIntent);
      return { ...navigationResult, thought: thought };

    } else if (userIntent?.Intent?.includes("Find information")) {
      logToFile('Intent: Find information');
      if (userIntent.About === "Conference") {
        logToFile('About: Conference');
        const conferences = await handleFindInformationConferenceIntent(userIntent);

        const generateTextResponseResult = await generateTextResponse(userInput, history, "Conference", conferences);
        return { ...generateTextResponseResult, thought: thought };

      } else if (userIntent.About === "Journal") {
        logToFile('About: Journal');
        const journals = await handleFindInformationJournalIntent(userIntent);
        const generateTextResponseResult = await generateTextResponse(userInput, history, "Journal", journals);
        return { ...generateTextResponseResult, thought: thought };

      } else if (userIntent.About === "Website") {
        logToFile('About: Website');
        const generateTextResponseResult = await generateTextResponse(userInput, history, "Website");
        return { ...generateTextResponseResult, thought: thought };

      } else {
        logToFile(`Invalid 'About' property: ${userIntent.About}`); // Log invalid About
        return {
          type: "error",
          message: "Invalid 'About' property for 'Find information' intent.",
          thought: "Invalid 'About' value",
        };
      }

    } else if (userIntent?.Intent?.includes("No intent")) {
      logToFile('Intent: No intent');
      return { type: "text", message: await handleNoIntent(), thought: thought };

    } else if (userIntent?.Intent?.includes("Invalid")) {
      logToFile('Intent: Invalid');
      return { type: "text", message: await handleInvalidIntent(userIntent), thought: thought };

    } else {
      logToFile(`Could not determine intent.  Intent list: ${userIntent?.Intent}`); // Log undetermined intent
      return {
        type: "error",
        message: "Could not determine the intent.",
        thought: "Intent determination failed",
      };
    }
  } catch (error: any) {
    logToFile(`Error in handleUserInput: ${error.message}, Stack: ${error.stack}`); // Log full error with stack trace
    return {
      type: "error",
      message: error.message || "An unexpected error occurred.",
      thought: "An error occurred",
    };
  }
}