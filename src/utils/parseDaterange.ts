import parser from "any-date-parser";
import { ConferenceDateInput } from "../types/types";
export function parseDateRange(dateRange: string | undefined): [Date, Date] | [null, null] {
    if(!dateRange) {
        return [null, null]
    }
  // Normalize dash types and remove any extra spaces
  console.log("date" ,dateRange);

  dateRange = dateRange.replace("–", "-").replace(/\s*,\s*/g, ", ").trim();
  let parts = dateRange.split(" - ");
  
  // If splitting by " - " fails, attempt to split by "–" (for cases like "October 16–19, 2024")
  if (parts.length === 1) {
    parts = dateRange.split("-");
  }
  if (parts.length !== 2) {
    let singleDate =  parser.fromString(dateRange);
    if(!singleDate.isValid())
      singleDate = parser.fromString('1' + dateRange);
      if(!singleDate.isValid())
      {
        return [null, null]
      }
    else 
      return [singleDate, singleDate]
  }

  let firstPart = parts[0].trim();
  let lastPart =firstPart.split(' ')[0] +" " + parts[1].trim() ;
  // Ensure that lastPart includes a year
  firstPart += ' ' + lastPart.split(' ')[2];

  let lastDate = parser.fromString(lastPart);
  if(! lastDate.isValid()) {
    lastPart = firstPart.split(' ')[0] + lastPart
    lastDate = parser.fromString(lastPart)
  }
  if (!lastDate) {
    return [null, null]
  }

  // If firstPart lacks a year, inherit from lastDate
  let firstDate = parser.fromString(firstPart);
  
  if (!firstDate) {

    firstPart += ` ${lastDate.getFullYear()}`;
    firstDate = parser.fromString(firstPart);
  }

  if (!firstDate) {
    return [null, null]
  }

  return [firstDate, lastDate];
}

export const converStringToDate = (
  date: string,
  type: string,
  organizedId : string
): ConferenceDateInput => {
  const [fromDate, toDate] = parseDateRange(date);
  return ({
          fromDate,
          toDate,
          type,
          name: "Conference Date",
          isAvailable: true,
          organizedId,
      })

};

export const convertObjectToDate = (
  date: Record<string, string | undefined>,
  type: string,
  organizedId : string
): ConferenceDateInput[] => {
  const result: ConferenceDateInput[] = [];
  for (const key in date) {
      const [fromDate, toDate] = parseDateRange(date[key]);
      result.push({
          fromDate,
          toDate,
          type,
          name: key,
          isAvailable: true,
          organizedId,
      });
  }
  return result;
};




