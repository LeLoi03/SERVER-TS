interface CombinedConference {
    id: string;
    title: string;
    acronym: string;
    location: {
      cityStateProvince: string;
      country: string;
      address: string; // Assuming you want address
      continent: string;
    };
    year: number;
    rankSourceFoRData?: {
      rank?: string;
      source: string;
      researchFields: string; // Consider making this an array
    };
    topics: string[];
    dates: {
      fromDate: string;
      toDate: string;
      type: string; // Add type for filtering by submission date, etc.
      name: string;
    };
    link: string;
    accessType: string; // "online", "offline", "hybrid"
    // Add other fields you need for filtering/displaying
    creatorId?: string; // Might be useful
    status?: string;    // "Pending", etc. (from AddedConference)
    callForPaper?: string; //From organization.
    summary?: string;
  }