// src/chatbot/utils/mockData.ts

export const summaryData = {
  "payload": [
    {
      "id": "00c6bf0f-520c-4702-8261-f929cfc51ed9",
      "title": "Workshop on Job Scheduling Strategies for Parallel Processing",
      "acronym": "JSSPP",
      "location": { "cityStateProvince": "Milan", "country": "Italy", "address": "Milan, Italy", "continent": "Europe" },
      "rank": "C",
      "source": "CORE2023",
      "year": 2025,
      "researchFields": ["Distributed computing and systems software"],
      "topics": ["parallel scheduling", "scheduling systems"],
      "dates": { "fromDate": "2025-06-03T00:00:00.000Z", "toDate": "2025-06-04T00:00:00.000Z", "type": "conferenceDates", "name": "Conference Date" },
      "link": "https://jsspp.org/",
      "accessType": "Offline",
      "status": "CRAWLED"
    },
    {
      "id": "02926ff4-408b-40d2-b7e9-7d55c3aff7cb",
      "title": "Information Visualisation Theory and Practice",
      "acronym": "InfVis",
      "location": { "cityStateProvince": "No city/state/province", "country": "No country", "address": "No location", "continent": "No continent" },
      "rank": "C",
      "source": "CORE2023",
      "year": 2025,
      "researchFields": ["Human-centred computing"],
      "topics": ["Navigation"],
      "dates": { "fromDate": "2025-08-06T00:00:00.000Z", "toDate": "2025-08-08T00:00:00.000Z", "type": "conferenceDates", "name": "Conference Date" },
      "link": "https://iv.csites.fct.unl.pt/de/symposia/iv/infvis/",
      "accessType": "Online",
      "status": "CRAWLED"
    }
  ],
  "meta": { "curPage": 1, "perPage": 10, "totalItems": 988, "totalPage": 99, "prevPage": null, "nextPage": 2 }
};

export const detailData = {
    "payload": [
        {
            "id": "00c6bf0f-520c-4702-8261-f929cfc51ed9",
            "title": "Workshop on Job Scheduling Strategies for Parallel Processing",
            "acronym": "JSSPP",
            "creatorId": null,
            "adminId": "54524c96-55a4-48d6-9b53-84263db1075e",
            "createdAt": "2025-06-22T09:10:01.070Z",
            "updatedAt": "2025-07-07T04:17:07.751Z",
            "status": "CRAWLED",
            "ranks": [
                {
                    "year": 2025,
                    "rank": "C",
                    "source": "CORE2023",
                    "researchField": "Distributed computing and systems software"
                }
            ],
            "organizations": [
                {
                    "org": {
                        "year": 2025,
                        "accessType": "Offline",
                        "summary": "The 28th Workshop on Job Scheduling Strategies for Parallel Processing (JSSPP 2025) will be held in conjunction with IPDPS 2025 in Milan, Italy, from June 3-4, 2025. The workshop focuses on challenges in parallel scheduling and invites submissions of Regular Papers, Open Scheduling Problems (OSP), and Workload Traces (WT). The proceedings will be published by Springer-Verlag in the Lecture Notes in Computer Science Series.",
                        "callForPaper": "# Call for Papers\n\nJSSPP welcomes novel, unpublished Regular Papers (RP) as well as descriptions of Open Scheduling Problems (OSP) and Workload Traces (WT) coming from interesting scheduling domains.\n\n## Call for Regular Papers (RP)\n\nJSSPP solicits regular papers that focus on challenges in parallel scheduling, including but not limited to:\n\n* Design of new scheduling approaches.\n* Performance evaluation of scheduling approaches, including methodology, benchmarks, and metrics.\n* Fulfilling additional constraints in scheduling systems, like job priorities, price, energy requirements (Green Computing), accounting, load estimation, and quality of service guarantees.\n* Impact of scheduling strategies on system utilization, application performance, user-friendliness, cost efficiency, and energy efficiency.\n* Scaling and architecture of very large scheduling systems.\n* Operational challenges: Capacity planning, service level assurance, reliability.\n* Interaction between schedulers on different levels (e.g., processor vs cluster) and tenancy domains (single and multi-tenant)\n* Interaction between applications/workloads, e.g., efficient batch job and container/Pod/VM co-scheduling within a single system, etc.\n* Experience reports from large-scale compute production systems.\n* GPU/Accelerator (co)scheduling.\n* AI/ML-inspired scheduling approaches.\n\n## Call for Workload Traces (WT)\n\nJSSPP welcomes novel, unpublished papers introducing workload traces from workloads of real systems that offer challenges in the context of this workshop. These submissions should include:\n\n* Anonymized (if needed) workload artifacts that describe a significant share of individual units of resource scheduling (jobs, pods, VMs, functions, etc.) during a period of life in a parallel computing system.\n* A description of the parallel system running these workloads.\n* An analysis of the traces, modeling key workload features and highlighting scheduling challenges in their hosting systems.\n\nWe ask submitters to employ known workload description languages (e.g., SWF) to represent their traces or to attach schemas that allow interpreting them. The submission of artifacts that model the workloads is also encouraged.\n\n## Call for Open Scheduling Problems (OSP)\n\nJSSPP welcomes novel, unpublished papers describing open problems in large-scale scheduling. Effective scheduling approaches are predicated on three things:\n\n* A concise understanding of scheduling goals, and how they relate to one another.\n* Details of the workload (job arrival times, sizes, shareability, deadlines, etc.)\n* Details of the system being managed (size, break/fix lifecycle, allocation constraints)\n\nSubmissions must include a concise description of the key metrics of the system and how they are calculated, as well as anonymized data publication of the system workload and production schedule. Ideally, anonymized operational logs would also be published, though we understand this might be more difficult. \n\n## Submission Format\n\nPaper formatting requirements are the same for Regular Papers, Workload Traces, and OSP-related submissions. Papers should be no longer than **20 single-spaced pages, 10pt font, including figures and references**. All submissions must follow the LNCS format. See the instructions at Springer's website: [http://www.springer.com/lncs](http://www.springer.com/lncs) or in the [Submission](index.php?page=submission) section.\n\nAll papers in scope will be reviewed by at least three members of the program committee.\n\nSubmissions are accepted by [EasyChair submission page](https://easychair.org/conferences/?conf=jsspp2025).\n\n## Important Dates\n\n* **Paper Submission Deadline:** February 24th, 2025 (FINAL)\n* **Author Notification:** March 14th, 2025 (approximate, extended)\n* **Camera-Ready Paper:** July 27th, 2025",
                        "link": "https://jsspp.org/",
                        "pulisher": "",
                        "cfpLink": "http://jsspp.org/index.php?page=cfp",
                        "locations": [
                            {
                                "address": "Milan, Italy",
                                "cityStateProvince": "Milan",
                                "country": "Italy",
                                "continent": "Europe"
                            }
                        ],
                        "topics": [
                            "parallel scheduling",
                            "scheduling systems",
                            "job priorities",
                            "price",
                            "energy requirements",
                            "Green Computing",
                            "accounting",
                            "load estimation",
                            "quality of service guarantees",
                            "system utilization",
                            "application performance",
                            "user-friendliness",
                            "cost efficiency",
                            "energy efficiency",
                            "scaling",
                            "architecture",
                            "capacity planning",
                            "service level assurance",
                            "reliability",
                            "processor scheduling",
                            "cluster scheduling",
                            "tenancy domains",
                            "batch job scheduling",
                            "container scheduling",
                            "Pod scheduling",
                            "VM scheduling",
                            "GPU scheduling",
                            "Accelerator scheduling",
                            "AI-inspired scheduling approaches",
                            "ML-inspired scheduling approaches"
                        ],
                        "dates": [
                            {
                                "fromDate": "2025-06-03T00:00:00.000Z",
                                "toDate": "2025-06-04T00:00:00.000Z",
                                "type": "conferenceDates",
                                "name": "Conference Date"
                            },
                            {
                                "fromDate": "2025-02-24T00:00:00.000Z",
                                "toDate": "2025-02-24T00:00:00.000Z",
                                "type": "submissionDate",
                                "name": "Paper Submission Deadline"
                            },
                            {
                                "fromDate": "2025-03-14T00:00:00.000Z",
                                "toDate": "2025-03-14T00:00:00.000Z",
                                "type": "notificationDate",
                                "name": "Author Notification"
                            },
                            {
                                "fromDate": "2025-07-27T00:00:00.000Z",
                                "toDate": "2025-07-27T00:00:00.000Z",
                                "type": "cameraReadyDate",
                                "name": "Camera-Ready Paper"
                            }
                        ]
                    }
                },
                {
                    "year": 2025,
                    "accessType": "Offline",
                    "summary": "",
                    "callForPaper": "",
                    "link": "https://jsspp.org/",
                    "pulisher": "",
                    "cfpLink": "http://jsspp.org/index.php?page=cfp",
                    "locations": [
                        {
                            "address": "Milan, Italy",
                            "cityStateProvince": "Milan",
                            "country": "Italy",
                            "continent": "Europe"
                        }
                    ],
                    "topics": [],
                    "dates": [
                        {
                            "fromDate": "2025-06-03T00:00:00.000Z",
                            "toDate": "2025-06-04T00:00:00.000Z",
                            "type": "conferenceDates",
                            "name": "Conference Date"
                        },
                        {
                            "fromDate": "2025-02-24T00:00:00.000Z",
                            "toDate": "2025-02-24T00:00:00.000Z",
                            "type": "submissionDate",
                            "name": "Paper Submission Deadline"
                        },
                        {
                            "fromDate": "2025-03-14T00:00:00.000Z",
                            "toDate": "2025-03-14T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Author Notification"
                        },
                        {
                            "fromDate": "2025-07-27T00:00:00.000Z",
                            "toDate": "2025-07-27T00:00:00.000Z",
                            "type": "cameraReadyDate",
                            "name": "Camera-Ready Paper"
                        }
                    ]
                }
            ]
        },
        {
            "id": "011db7a3-8c5a-46b6-8cf7-a3dde2f5f43a",
            "title": "International Conference on Computer Vision and Graphics",
            "acronym": "ICCVG",
            "creatorId": null,
            "adminId": "54524c96-55a4-48d6-9b53-84263db1075e",
            "createdAt": "2025-06-22T09:09:44.834Z",
            "updatedAt": "2025-07-07T04:17:00.676Z",
            "status": "CRAWLED",
            "ranks": [
                {
                    "year": 2025,
                    "rank": "National: Poland",
                    "source": "CORE2023",
                    "researchField": "Computer vision and multimedia computation"
                },
                {
                    "year": 2025,
                    "rank": "National: Poland",
                    "source": "CORE2023",
                    "researchField": "Graphics, augmented reality and games"
                },
                {
                    "year": 2025,
                    "rank": "National: Poland",
                    "source": "CORE2023",
                    "researchField": "Artificial intelligence"
                }
            ],
            "organizations": [
                {
                    "org": {
                        "year": null,
                        "accessType": "Offline",
                        "summary": "The International Conference on Computer Vision and Graphics (ICCVG) is a biennial conference held in Poland since 2002, organized by the Association for Image Processing, Poland. ICCVG 2024 will take place from September 16-18, 2024, at the Warsaw University of Life Sciences - SGGW.",
                        "callForPaper": "# Call for Papers: ICCVG 2024\n\nThe International Conference on Computer Vision and Graphics (ICCVG) 2024 welcomes papers on computer vision and graphics. The conference encourages both classical and Artificial Intelligence-type approaches.\n\n## Topics of Interest\n\nThe topics include, but are not limited to:\n\n*   Modelling of human visual perception\n*   Computational geometry\n*   Geometrical models of objects and scenes\n*   Illumination and reflection models and methods\n*   Image formation\n*   Image and video coding\n*   Image filtering and enhancement\n*   Biomedical image processing\n*   Biomedical graphics\n*   Colour image processing\n*   Multispectral image processing\n*   Pattern recognition in image processing\n*   Scene understanding\n*   Motion analysis, visual navigation and active vision\n*   Human motion detection and analysis\n*   Visualisation and graphical data presentation\n*   Hardware and architectures for image processing\n*   Computer-aided graphic design\n*   3D imaging, shading and rendering\n*   Computer animation\n*   Graphics for internet and mobile systems\n*   Virtual reality\n*   Image and video databases\n*   Visual cryptography\n*   Digital watermarking\n*   Multimedia applications\n*   Computer art\n*   Image processing applications in industry, engineering, life sciences, geophysics etc.\n\n## Important Dates\n\n*   **Paper submission:** July 1, 2024 (extended)\n*   **Paper acceptance:** August 17 (extended)\n*   **Camera ready papers:** August 29 (extended)\n*   **Conference:** September 16-18, 2024\n\n## Submission\n\nSee the section \"How to Submit\" on the conference website.\n\n## Publication\n\nThe proceedings of the conference will be published in Lecture Notes in Networks and Systems (LNNS), Springer. Extended versions of selected outstanding papers will be published in Machine Graphics and Vision.\n\n## Contact\n\n*   Email: [iccvg@sggw.edu.pl](mailto:iccvg@sggw.edu.pl)\n*   Phone: +48 22 593 7227",
                        "link": "https://iccvg.sggw.edu.pl/event/1/",
                        "pulisher": "",
                        "cfpLink": "https://iccvg.sggw.edu.pl/event/1/page/3-call-for-papers",
                        "locations": [
                            {
                                "address": "No location",
                                "cityStateProvince": "No city/state/province",
                                "country": "No country",
                                "continent": "No continent"
                            }
                        ],
                        "topics": [
                            "No topics"
                        ],
                        "dates": [
                            {
                                "fromDate": null,
                                "toDate": null,
                                "type": "conferenceDates",
                                "name": "Conference Date"
                            }
                        ]
                    }
                },
                {
                    "year": 2024,
                    "accessType": "Offline",
                    "summary": "",
                    "callForPaper": "",
                    "link": "https://iccvg.sggw.edu.pl/event/1/",
                    "pulisher": "",
                    "cfpLink": "https://iccvg.sggw.edu.pl/event/1/page/3-call-for-papers",
                    "locations": [
                        {
                            "address": "Warsaw University of Life Sciences - SGGW, Nowoursynowska 159 Warszawa, Poland",
                            "cityStateProvince": "Warsaw",
                            "country": "Poland",
                            "continent": "Europe"
                        }
                    ],
                    "topics": [],
                    "dates": [
                        {
                            "fromDate": "2024-09-16T00:00:00.000Z",
                            "toDate": "2024-09-18T00:00:00.000Z",
                            "type": "conferenceDates",
                            "name": "Conference Date"
                        },
                        {
                            "fromDate": "2024-07-01T00:00:00.000Z",
                            "toDate": "2024-07-01T00:00:00.000Z",
                            "type": "submissionDate",
                            "name": "Paper submission"
                        },
                        {
                            "fromDate": "2024-08-29T00:00:00.000Z",
                            "toDate": "2024-08-29T00:00:00.000Z",
                            "type": "cameraReadyDate",
                            "name": "Camera ready papers"
                        },
                        {
                            "fromDate": "2024-08-17T00:00:00.000Z",
                            "toDate": "2024-08-17T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Paper acceptance"
                        }
                    ]
                }
            ]
        },
        {
            "id": "0183e440-cee4-4be4-a3c0-ac5b2281cbee",
            "title": "Conference on Theory and Applications of Models of Computation",
            "acronym": "TAMC",
            "creatorId": null,
            "adminId": "54524c96-55a4-48d6-9b53-84263db1075e",
            "createdAt": "2025-06-22T09:09:34.432Z",
            "updatedAt": "2025-07-07T04:17:16.110Z",
            "status": "CRAWLED",
            "ranks": [
                {
                    "year": 2025,
                    "rank": "C",
                    "source": "CORE2023",
                    "researchField": "Theory of computation"
                }
            ],
            "organizations": [
                {
                    "year": 2025,
                    "accessType": "Offline",
                    "summary": "The 19th Annual Conference on Theory and Applications of Models of Computation (TAMC 2025) will be held from September 19-21, 2025, in Jinan, China. The conference focuses on computational theory, information theory, and applications, with main themes including computability, complexity, algorithms, and their extensions to machine learning and AI. ",
                    "callForPaper": "# Call for Papers\n\nThe 19th Annual Conference on Theory and Applications of Models of Computation (TAMC 2025) will be held on **September 19-21, 2025** in **Jinan, China**.\n\nTAMC 2025 aims at bringing together a wide range of researchers with interest in computational theory, information theory and applications. The main themes of the conference are computability, complexity, algorithms, information theory and their extensions to machine learning theory, and foundations of artificial intelligence.\n\n## Topics of Interest\n\nThe topics of interest include (but are not limited to) the following:\n\n* Computational complexity and algorithms\n* Models of computation\n* Automata theory and formal languages\n* Quantum computing\n* Algorithmic game theory\n* Cryptography and data security\n* Computational biology and bioinformatics\n* Parallel and distributed computing\n* Formal verification and program analysis\n* Computational geometry and graph theory\n* Logic and proof theory\n* Computational social choice\n* Combinatorial optimization\n\n## Important Dates\n\n* **Submission deadline:** June 1, 2025\n* **Notification of acceptance:** July 1, 2025\n* **Camera-ready and registration:** July 15, 2025\n* **Conference dates:** September 19-21, 2025\n\n## Paper Submission\n\nThe submission should contain scholarly exposition of ideas, techniques, and results, including the motivation and a clear comparison with related work. The length of the submission should not exceed 12 pages in LNCS style (including references, but excluding the optional appendix). Appendices should be placed at the end of the main body (after references, in the same file). For code and data, authors can provide anonymous download links or refer to an anonymized GitHub repository. The Program Committee (PC) will review the content in the appendices and links at their discretion. The submitted papers will be reviewed in a double-blind peer review manner. Please delete the author information on your manuscript. All submissions must be submitted electronically through Easychair: [This is the submission link](https://easychair.org/conferences/?conf=tamc2025).\n\n## Publication\n\nThe proceedings of the Conference will be published by Springer-Verlag in the Lecture Notes in Computer Science (LNCS) series. Selected high quality papers will be invited to Theoretical Computer Science, and other journals. Previous TAMC proceedings were also published by Springer, which can be found from the link: [https://link.springer.com/conference/tamc](https://link.springer.com/conference/tamc)\n\n## Awards\n\nAwards will be given to the best paper and the best student paper. To be eligible for the best student paper award, all authors must be full-time students at the time of submission. Please indicate in the final line of the abstract that the paper is being considered for the best student paper award. The program committee reserves the right to withhold these awards or to split them between multiple recipients.",
                    "link": "http://www.maths.sdnu.edu.cn/TAMC2025.htm",
                    "pulisher": "",
                    "cfpLink": "http://www.maths.sdnu.edu.cn/TAMC2025.htm#Program",
                    "locations": [
                        {
                            "address": "Jinan, China",
                            "cityStateProvince": "Jinan",
                            "country": "China",
                            "continent": "Asia"
                        }
                    ],
                    "topics": [
                        "Computational complexity and algorithms",
                        "Models of computation",
                        "Automata theory and formal languages",
                        "Quantum computing",
                        "Algorithmic game theory",
                        "Cryptography and data security",
                        "Computational biology and bioinformatics",
                        "Parallel and distributed computing",
                        "Formal verification and program analysis",
                        "Computational geometry and graph theory",
                        "Logic and proof theory",
                        "Computational social choice",
                        "Combinatorial optimization"
                    ],
                    "dates": [
                        {
                            "fromDate": "2025-09-19T00:00:00.000Z",
                            "toDate": "2025-09-21T00:00:00.000Z",
                            "type": "conferenceDates",
                            "name": "Conference Date"
                        },
                        {
                            "fromDate": "2025-06-01T00:00:00.000Z",
                            "toDate": "2025-06-01T00:00:00.000Z",
                            "type": "submissionDate",
                            "name": "Submission deadline"
                        },
                        {
                            "fromDate": "2025-07-01T00:00:00.000Z",
                            "toDate": "2025-07-01T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Notification of acceptance"
                        },
                        {
                            "fromDate": "2025-07-15T00:00:00.000Z",
                            "toDate": "2025-07-15T00:00:00.000Z",
                            "type": "cameraReadyDate",
                            "name": "Camera-ready and registration"
                        }
                    ]
                }
            ]
        },
        {
            "id": "01db3125-95a5-4739-b594-ff98161dcbd6",
            "title": "Usenix Network and Distributed System Security Symposium",
            "acronym": "NDSS",
            "creatorId": null,
            "adminId": "54524c96-55a4-48d6-9b53-84263db1075e",
            "createdAt": "2025-06-22T09:09:59.986Z",
            "updatedAt": "2025-07-07T04:17:10.140Z",
            "status": "CRAWLED",
            "ranks": [
                {
                    "year": 2025,
                    "rank": "A*",
                    "source": "CORE2023",
                    "researchField": "Cybersecurity and privacy"
                }
            ],
            "organizations": [
                {
                    "org": {
                        "year": 2026,
                        "accessType": "Offline",
                        "summary": "The Network and Distributed System Security Symposium (NDSS) is a leading security forum. NDSS 2026 will take place in San Diego, California, from 23 to 27 February 2026.",
                        "callForPaper": "# NDSS 2026 Call for Papers\n\nThe Network and Distributed System Security (NDSS) Symposium is a top venue that fosters information exchange among researchers and practitioners of network and distributed system security. The NDSS Symposium 2026 and co-located workshops will take place in **San Diego, CA, from 23 to 27 February 2026**.\n\n## Target Audience\n\nThe target audience includes everyone interested in practical aspects of network and distributed system security, with a focus on system design and implementation. A major goal is to encourage and enable the Internet community to apply, deploy, and advance the state of practical security technologies.\n\n## Submission Information\n\n* Authors are encouraged to write the abstract and introduction of their paper in a way that makes the results accessible and compelling to a general security researcher.\n* All submissions will be reviewed by the Program Committee and accepted submissions will be published by the Internet Society in the Proceedings of NDSS Symposium 2026. The Proceedings will be made freely accessible from the Internet Society web pages.\n* Permission to freely reproduce all or parts of papers for noncommercial purposes is granted provided that copies bear the Internet Society notice included on the first page of the paper.\n* The authors are thus free to post the camera-ready versions of their papers on their personal pages and within their institutional repositories. Reproduction for commercial purposes is strictly prohibited and requires prior consent.\n\n### Summary of New Guidelines\n\n* **Bulk submission limitation:** Each author can be listed on a maximum of six (6) submissions per cycle (12 total).\n* Authors cannot be added to a submission at any point for any reason after the submission deadline.\n* Wide advertisement of the paper during the review process is disallowed.\n* Major overlap between a rejected paper from the summer cycle and a submission to the fall cycle is disallowed.\n* Failure to meet the new requirements would be grounds for desk rejection.\n\n## Review Cycles\n\nNDSS Symposium 2026 will have two review cycles: a summer submission cycle and a fall submission cycle. The full list of important dates for each session is listed below. All submissions must be received by 11:59 PM AoE (UTC-12) on the day of the corresponding deadline.\n\n### Decision Categories\n\nFor each submission to any of the two review cycles, one of the following decisions will be made:\n\n* **Accept:** Papers in this category will be accepted for publication in the proceedings and presentation at the conference.\n* **Minor Revision:** Papers in this category will be accepted for publication in the proceedings and presentation at the conference if and only if they undergo a minor revision and the revision is determined satisfactory by their shepherd(s).\n* **Major Revision:** Papers in this category are considered promising but need additional work (e.g., new implementations, experiments, and/or proofs). Authors may choose to revise and resubmit such papers to NDSS Symposium 2026, with appropriate revisions, and within six weeks after notification (see specific deadlines below). The revision and second review of “Major Revision” papers will be based on a list of “revision tasks” clearly specified by the original reviewers and conveyed to the authors upon notification. A revised paper will be accepted to NDSS 2026 if it satisfactorily fulfills the revision tasks. A paper may undergo at most one major revision for NDSS 2026.\n* **Reject:** Papers in this category are not allowed to be resubmitted to NDSS Symposium 2026.\n\n## Important Dates\n\nAll deadlines are on Wednesdays, and all are 11:59 PM AoE (UTC-12).\n\n### Summer Cycle\n\n* **Wed, 23 April 2025:** Paper submission deadline\n* **Wed, 28 May 2025:** Early reject/Round 2 notification and Round 1 reviews\n* **Wed, 18 Jun to Fri, Jun 20, 2025:** Author rebuttal\n* **Wed, 18 June to Wed, 25 June 2025:** Interactive discussion with reviewers\n* **Wed, 2 July 2025:** Author notification\n* **Wed, 30 July 2025:** Resubmission of Major Revision papers, Minor Revision decision\n* **Wed, 13 August 2025:** Author notification for Major Revision\n* **Wed, 10 September 2025:** Camera Ready deadline\n\n### Fall Cycle\n\n* **Wed, 6 August 2025:** Paper submission deadline\n* **Wed, 17 September 2025:** Early reject/Round 2 notification and Round 1 reviews\n* **Wed, 8 October to Fri, 10 October 2025:** Author rebuttal\n* **Wed, 8 October to Wed, 15 October 2025:** Interactive discussion with reviewers\n* **Wed, 22 October 2025:** Author notification\n* **Wed, 19 November 2025:** Resubmission of Major Revision papers, Minor Revision decision\n* **Wed, 3 December 2025:** Author notification for Major Revision\n* **Wed, 17 December 2025:** Camera Ready deadline\n\n## Areas/Topics of Interest\n\nSubmissions are solicited in, but not limited to, the following areas:\n\n* Anti-malware techniques: detection, analysis, and prevention\n* Cyber attack (e.g., APTs, botnets, DDoS) prevention, detection, investigation, and response\n* Cyber-crime defense and forensics (e.g., anti-phishing, anti-blackmailing, anti-fraud techniques)\n* Integrating security in network protocols (e.g., routing, naming, and management)\n* Mobile and wireless network security\n* Network security policy implementation, deployment, and management\n* Privacy and anonymity in networks and distributed systems\n* Public key infrastructures, key management, certification, and revocation\n* Security and privacy for blockchains and cryptocurrencies\n* Security and privacy of mobile/smartphone platforms\n* Security and privacy of operating systems, hypervisors, and virtual machines\n* Security and privacy of systems based on machine learning, federated learning, AI, and large language models\n* Security for cloud/edge computing\n* Security for cyber-physical systems (e.g., autonomous vehicles, industrial control systems)\n* Security for emerging networks (e.g., smart homes, IoT, body-area networks, VANETs)\n* Security for future Internet architectures and designs (e.g., Software-Defined Networking, Intent-Based Networking)\n* Security for large-scale, critical infrastructures (e.g., electronic voting, smart grid)\n* Security of web-based applications and services (e.g., social networking, crowd-sourcing, fake news/disinformation), web security and privacy\n* Software/firmware/hardware security analysis, customization, and extensions\n* Special problems and case studies: e.g., tradeoffs between security and efficiency, usability, cost, and ethics\n* Trustworthy computing software and hardware to secure networks and systems\n* Usable security and privacy\n\nPapers that focus on the systematization of knowledge (called SoK-papers at other venues) are within the scope of NDSS Symposium, particularly if they provide new insights and compelling evidence.\n\n## Topic Fit\n\nNDSS Symposium is primarily a venue focusing on network and systems security. Papers that have questionable fit to NDSS Symposium will be pre-filtered by a select sub-committee on “Topic Concerns” and may be desk rejected without reviews.\n\n## Paper Formatting\n\nTechnical papers submitted for NDSS Symposium must not exceed **13 pages**, excluding the “Ethics Considerations” section, references, or appendices, and must be written in English. Papers must be formatted for **US letter size** (not A4) paper in a two-column layout, with columns no more than 9.25 in. high and 3.5 in. wide. The text must be in Times font, 10-point or larger, with 11-point or larger line spacing. Authors must use the [NDSS templates](https://www.ndss-symposium.org/ndss2025/submissions/templates/). Submissions must be in Portable Document Format (.pdf).\n\n## Ethical Considerations\n\nEach paper may optionally include an “Ethics Considerations” section immediately preceding the reference section. In this section, the authors may discuss if they believe the work poses any ethical risk and the steps that are taken to mitigate such risk.\n\n## Anonymous Submissions\n\nNDSS Symposium implements a double-blind reviewing process. Author names and affiliations should not appear in the paper. The authors should make a reasonable effort not to reveal their identities or institutional affiliations in the text, figures, photos, links, or other data that is contained in the paper. Authors’ prior work must be referred to in the third person; if this is not feasible, the references should be blinded. Submissions that violate these requirements will be rejected without review. The list of authors cannot be changed while the paper is under review unless approved by the Program Chairs. Publishing a technical report on a preprint repository, such as arXiv, while not encouraged, is not forbidden. Authors should refrain from broadly advertising their results and may not contact TPC members regarding their submitted work. Please contact the PC chairs if you have questions or concerns. In addition, new authors cannot be added to any submission for any reason after the submission deadline.\n\n## Conflicts of Interest\n\nAuthors and Program Committee members are required to indicate any conflict of interest and its nature. Advisors and advisees are perpetually conflicted (regardless of graduation date). Authors and PC members with an institutional relationship are considered to share a conflict of interest. Professional collaborations (irrespective of whether they resulted in publication or funding) that occurred in the past 2 years and close personal relationships also constitute a conflict of interest. PC members, including chairs, that have a conflict of interest with a paper, will be excluded from the evaluation of that paper. Other cases (grey areas) should be brought to the PC Co-Chairs’ attention prior to the submission deadline. The PC Co-Chairs are not allowed to submit papers to the conference. Declaring conflicts of interest to avoid certain (otherwise non-conflicting) PC members is not allowed and can constitute grounds for rejection. The PC Chairs reserve the right to request additional explanation for any declared conflict. If authors have concerns about the fair treatment of their submissions, they should instead contact the chairs and provide convincing arguments for any special consideration that they are requesting.\n\n## Use of Generative AI\n\nThe use of Generative Artificial Intelligence, i.e., tools capable of generating text, images, or other data using generative models, often in response to prompts, is permitted for paper preparation as long as (1) the result does not plagiarize, misrepresent, or falsify content, (2) the resulting work in its totality is an accurate representation of the authors’ underlying work and novel intellectual contributions and is not primarily the result of the tools’ generative capabilities, and (3) the authors accept responsibility for the veracity and correctness of all material in their paper, including any AI-generated material.\n\nThe use of generative AI software tools must be disclosed as part of the paper submission. The level of disclosure should be commensurate with the proportion of new text or content generated by these tools. If entire (sub)sections of a paper, including tables, graphs, images, and other content were AI-generated, the authors must disclose which sections and which tools and tool versions were used to generate those sections (e.g., by preparing an Appendix that describes the use, specific tools and versions, the text of the prompts provided as input, and any post-generation editing). If the amount of text being generated is small (limited to phrases or a few sentences), then it would be sufficient to add a citation or a footnote to the relevant section of the submission utilizing the system(s) and include a general disclaimer in the Acknowledgements section. If generative AI software tools are only used to edit and improve the quality of human-generated existing text in much the same way as one would use a basic word processing system to correct spelling or grammar or use a typing assistant (like Grammarly) to improve spelling, grammar, punctuation, clarity, engagement, it is not necessary to disclose such usage of these tools in the paper.\n\n## Submissions\n\nThe submission site for the summer review cycle is at [https://ndss26-summer.hotcrp.com/](https://ndss26-summer.hotcrp.com/).\n\nThe submission site for the fall review cycle is at [https://ndss26-fall.hotcrp.com/](https://ndss26-fall.hotcrp.com/).\n\nFor any questions, please contact the PC chair at [ndss-pc-chair@elists.isoc.org](mailto:ndss-pc-chair@elists.isoc.org).",
                        "link": "https://www.ndss-symposium.org/",
                        "pulisher": "",
                        "cfpLink": "https://www.ndss-symposium.org/ndss2026/submissions/call-for-papers/",
                        "locations": [
                            {
                                "address": "San Diego, California",
                                "cityStateProvince": "San Diego, California",
                                "country": "United States",
                                "continent": "North America"
                            }
                        ],
                        "topics": [
                            "Anti-malware techniques",
                            "Cyber attack prevention",
                            "Cyber-crime defense and forensics",
                            "Integrating security in network protocols",
                            "Mobile and wireless network security",
                            "Network security policy implementation",
                            "Privacy and anonymity in networks and distributed systems",
                            "Public key infrastructures",
                            "Security and privacy for blockchains and cryptocurrencies",
                            "Security and privacy of mobile/smartphone platforms",
                            "Security and privacy of operating systems",
                            "Security and privacy of systems based on machine learning",
                            "Security for cloud/edge computing",
                            "Security for cyber-physical systems",
                            "Security for emerging networks",
                            "Security for future Internet architectures and designs",
                            "Security for large-scale",
                            "critical infrastructures",
                            "Security of web-based applications and services",
                            "Software/firmware/hardware security analysis",
                            "Trustworthy computing software and hardware",
                            "Usable security and privacy"
                        ],
                        "dates": [
                            {
                                "fromDate": "2026-02-23T00:00:00.000Z",
                                "toDate": "2026-02-27T00:00:00.000Z",
                                "type": "conferenceDates",
                                "name": "Conference Date"
                            },
                            {
                                "fromDate": "2025-04-23T00:00:00.000Z",
                                "toDate": "2025-04-23T00:00:00.000Z",
                                "type": "submissionDate",
                                "name": "Summer Cycle Paper submission deadline"
                            },
                            {
                                "fromDate": "2025-08-06T00:00:00.000Z",
                                "toDate": "2025-08-06T00:00:00.000Z",
                                "type": "submissionDate",
                                "name": "Fall Cycle Paper submission deadline"
                            },
                            {
                                "fromDate": "2025-05-28T00:00:00.000Z",
                                "toDate": "2025-05-28T00:00:00.000Z",
                                "type": "notificationDate",
                                "name": "Summer Cycle Early reject/Round 2 notification and Round 1 reviews"
                            },
                            {
                                "fromDate": "2025-07-02T00:00:00.000Z",
                                "toDate": "2025-07-02T00:00:00.000Z",
                                "type": "notificationDate",
                                "name": "Summer Cycle Author notification"
                            },
                            {
                                "fromDate": "2025-08-13T00:00:00.000Z",
                                "toDate": "2025-08-13T00:00:00.000Z",
                                "type": "notificationDate",
                                "name": "Summer Cycle Author notification for Major Revision"
                            },
                            {
                                "fromDate": "2025-09-17T00:00:00.000Z",
                                "toDate": "2025-09-17T00:00:00.000Z",
                                "type": "notificationDate",
                                "name": "Fall Cycle Early reject/Round 2 notification and Round 1 reviews"
                            },
                            {
                                "fromDate": "2025-10-22T00:00:00.000Z",
                                "toDate": "2025-10-22T00:00:00.000Z",
                                "type": "notificationDate",
                                "name": "Fall Cycle Author notification"
                            },
                            {
                                "fromDate": "2025-12-03T00:00:00.000Z",
                                "toDate": "2025-12-03T00:00:00.000Z",
                                "type": "notificationDate",
                                "name": "Fall Cycle Author notification for Major Revision"
                            },
                            {
                                "fromDate": "2025-09-10T00:00:00.000Z",
                                "toDate": "2025-09-10T00:00:00.000Z",
                                "type": "cameraReadyDate",
                                "name": "Summer Cycle Camera Ready deadline"
                            },
                            {
                                "fromDate": "2025-12-17T00:00:00.000Z",
                                "toDate": "2025-12-17T00:00:00.000Z",
                                "type": "cameraReadyDate",
                                "name": "Fall Cycle Camera Ready deadline"
                            },
                            {
                                "fromDate": "2025-06-18T00:00:00.000Z",
                                "toDate": "2025-06-20T00:00:00.000Z",
                                "type": "otherDate",
                                "name": "Summer Cycle Author rebuttal"
                            },
                            {
                                "fromDate": "2025-06-18T00:00:00.000Z",
                                "toDate": "2025-06-25T00:00:00.000Z",
                                "type": "otherDate",
                                "name": "Summer Cycle Interactive discussion with reviewers"
                            },
                            {
                                "fromDate": "2025-07-30T00:00:00.000Z",
                                "toDate": "2025-07-30T00:00:00.000Z",
                                "type": "otherDate",
                                "name": "Summer Cycle Resubmission of Major Revision papers, Minor Revision decision"
                            },
                            {
                                "fromDate": "2025-10-08T00:00:00.000Z",
                                "toDate": "2025-10-10T00:00:00.000Z",
                                "type": "otherDate",
                                "name": "Fall Cycle Author rebuttal"
                            },
                            {
                                "fromDate": "2025-10-08T00:00:00.000Z",
                                "toDate": "2025-10-15T00:00:00.000Z",
                                "type": "otherDate",
                                "name": "Fall Cycle Interactive discussion with reviewers"
                            },
                            {
                                "fromDate": "2025-11-19T00:00:00.000Z",
                                "toDate": "2025-11-19T00:00:00.000Z",
                                "type": "otherDate",
                                "name": "Fall Cycle Resubmission of Major Revision papers, Minor Revision decision"
                            }
                        ]
                    }
                },
                {
                    "year": 2026,
                    "accessType": "Offline",
                    "summary": "",
                    "callForPaper": "",
                    "link": "https://www.ndss-symposium.org/",
                    "pulisher": "",
                    "cfpLink": "https://www.ndss-symposium.org/ndss2026/submissions/call-for-papers/",
                    "locations": [
                        {
                            "address": "San Diego, California",
                            "cityStateProvince": "San Diego, California",
                            "country": "United States",
                            "continent": "North America"
                        }
                    ],
                    "topics": [],
                    "dates": [
                        {
                            "fromDate": "2026-02-23T00:00:00.000Z",
                            "toDate": "2026-02-27T00:00:00.000Z",
                            "type": "conferenceDates",
                            "name": "Conference Date"
                        },
                        {
                            "fromDate": "2025-04-23T00:00:00.000Z",
                            "toDate": "2025-04-23T00:00:00.000Z",
                            "type": "submissionDate",
                            "name": "Summer Cycle Paper submission deadline"
                        },
                        {
                            "fromDate": "2025-08-06T00:00:00.000Z",
                            "toDate": "2025-08-06T00:00:00.000Z",
                            "type": "submissionDate",
                            "name": "Fall Cycle Paper submission deadline"
                        },
                        {
                            "fromDate": "2025-05-28T00:00:00.000Z",
                            "toDate": "2025-05-28T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Summer Cycle Early reject/Round 2 notification and Round 1 reviews"
                        },
                        {
                            "fromDate": "2025-07-02T00:00:00.000Z",
                            "toDate": "2025-07-02T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Summer Cycle Author notification"
                        },
                        {
                            "fromDate": "2025-08-13T00:00:00.000Z",
                            "toDate": "2025-08-13T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Summer Cycle Author notification for Major Revision"
                        },
                        {
                            "fromDate": "2025-09-17T00:00:00.000Z",
                            "toDate": "2025-09-17T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Fall Cycle Early reject/Round 2 notification and Round 1 reviews"
                        },
                        {
                            "fromDate": "2025-10-22T00:00:00.000Z",
                            "toDate": "2025-10-22T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Fall Cycle Author notification"
                        },
                        {
                            "fromDate": "2025-12-03T00:00:00.000Z",
                            "toDate": "2025-12-03T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Fall Cycle Author notification for Major Revision"
                        },
                        {
                            "fromDate": "2025-09-10T00:00:00.000Z",
                            "toDate": "2025-09-10T00:00:00.000Z",
                            "type": "cameraReadyDate",
                            "name": "Summer Cycle Camera Ready deadline"
                        },
                        {
                            "fromDate": "2025-12-17T00:00:00.000Z",
                            "toDate": "2025-12-17T00:00:00.000Z",
                            "type": "cameraReadyDate",
                            "name": "Fall Cycle Camera Ready deadline"
                        },
                        {
                            "fromDate": "2025-06-18T00:00:00.000Z",
                            "toDate": "2025-06-20T00:00:00.000Z",
                            "type": "otherDate",
                            "name": "Summer Cycle Author rebuttal"
                        },
                        {
                            "fromDate": "2025-06-18T00:00:00.000Z",
                            "toDate": "2025-06-25T00:00:00.000Z",
                            "type": "otherDate",
                            "name": "Summer Cycle Interactive discussion with reviewers"
                        },
                        {
                            "fromDate": "2025-07-30T00:00:00.000Z",
                            "toDate": "2025-07-30T00:00:00.000Z",
                            "type": "otherDate",
                            "name": "Summer Cycle Resubmission of Major Revision papers, Minor Revision decision"
                        },
                        {
                            "fromDate": "2025-10-08T00:00:00.000Z",
                            "toDate": "2025-10-10T00:00:00.000Z",
                            "type": "otherDate",
                            "name": "Fall Cycle Author rebuttal"
                        },
                        {
                            "fromDate": "2025-10-08T00:00:00.000Z",
                            "toDate": "2025-10-15T00:00:00.000Z",
                            "type": "otherDate",
                            "name": "Fall Cycle Interactive discussion with reviewers"
                        },
                        {
                            "fromDate": "2025-11-19T00:00:00.000Z",
                            "toDate": "2025-11-19T00:00:00.000Z",
                            "type": "otherDate",
                            "name": "Fall Cycle Resubmission of Major Revision papers, Minor Revision decision"
                        }
                    ]
                }
            ]
        },
        {
            "id": "01e3546e-404e-4dd5-a070-d5698901fca2",
            "title": "International Machine Vision and Image Processing Conference",
            "acronym": "IMVIP",
            "creatorId": null,
            "adminId": "54524c96-55a4-48d6-9b53-84263db1075e",
            "createdAt": "2025-06-22T09:09:52.249Z",
            "updatedAt": "2025-07-07T04:17:04.694Z",
            "status": "CRAWLED",
            "ranks": [
                {
                    "year": 2025,
                    "rank": "National: ireland",
                    "source": "CORE2023",
                    "researchField": "Computer vision and multimedia computation"
                }
            ],
            "organizations": [
                {
                    "year": 2025,
                    "accessType": "Offline",
                    "summary": "IMVIP 2025, the annual conference of the Irish Pattern Recognition and Classification Society, will take place from September 1-3, 2025, at Ulster University in Derry~Londonderry, Northern Ireland.  The conference invites submissions of papers presenting novel research contributions or applications related to any aspect of computer vision or image processing.",
                    "callForPaper": "# IMVIP 2025: Call for Papers\n\nIMVIP 2025 will take place from **September 1-3, 2025, at Ulster University in Derry~Londonderry, Northern Ireland**.\n\nIMVIP is the annual conference of the Irish Pattern Recognition and Classification Society, a member body of the International Association for Pattern Recognition (IAPR).\n\n## Topics of Interest\n\nWe invite submissions to IMVIP 2025 of papers presenting novel research contributions or applications related to any aspect of computer vision or image processing. Contributions are sought in all aspects of image processing, pattern analysis, and machine vision, including but not restricted to the following topics:\n\n*   Visually Guided Robot Manipulation and Navigation\n*   Computer Vision for Autonomous Vehicles\n*   Augmented Reality/Virtual Reality\n*   Data Clustering and Texture Analysis\n*   Image & Video Representation, Compression and Coding\n*   Medical and Biomedical Imaging\n*   Active Vision, Tracking and Motion Analysis\n*   Object and Event Recognition\n*   Face and Gesture Recognition\n*   2D, 3D Scene Analysis and Visualisation\n*   Deep Learning for Computer Vision\n*   Image/Shape Representation and Recovery\n*   Applications, Architectures and Systems Integration\n\n## Submission Details\n\nFull Papers must be a maximum of 8 pages including references and appendices.\n\n## Templates\n\n*   [Latex Template](imvip_Formatting_Instructions.zip)\n*   [Paper MS Word Templates](imvip_Formatting_Instructions.docx)\n\n## Important Dates\n\n*   **Full Paper Deadline:** May 16, 2025\n*   **Full Paper Acceptance Notification:** June 30, 2025\n*   **Camera Ready Deadline:** July 15, 2025\n*   **Early Bird Registration:** June 30 - July 10, 2025\n*   **Conference dates:** September 1-3, 2025\n\n## Organising Committee\n\n*   Prof. Sonya Coleman, Ulster University, Chair\n*   Dr. Dermot Kerr, Ulster University, Chair\n\n**Contact for enquiries:** [sa.coleman at ulster dot ac dot uk](mailto:sa.coleman at ulster dot ac dot uk)",
                    "link": "https://imvipconference.github.io/",
                    "pulisher": "",
                    "cfpLink": "https://easychair.org/conferences/?conf=imvip2025",
                    "locations": [
                        {
                            "address": "Ulster University, Derry~Londonderry, Northern Ireland",
                            "cityStateProvince": "Derry~Londonderry",
                            "country": "Northern Ireland",
                            "continent": "Europe"
                        }
                    ],
                    "topics": [
                        "Computer Vision",
                        "Image Processing",
                        "Augmented Reality",
                        "Virtual Reality",
                        "Texture Analysis",
                        "Coding",
                        "Medical Imaging",
                        "Tracking",
                        "Visualisation",
                        "Shape Representation",
                        "Applications",
                        "Architectures",
                        "Visually Guided Robot Manipulation and Navigation",
                        "Computer Vision for Autonomous Vehicles",
                        "Data Clustering",
                        "Image Representation",
                        "Video Representation",
                        "Compression",
                        "Biomedical Imaging",
                        "Active Vision",
                        "Motion Analysis",
                        "Object Recognition",
                        "Event Recognition",
                        "Face Recognition",
                        "Gesture Recognition",
                        "2D Scene Analysis",
                        "3D Scene Analysis",
                        "Deep Learning for Computer Vision",
                        "Image Representation",
                        "Recovery",
                        "Systems Integration"
                    ],
                    "dates": [
                        {
                            "fromDate": "2025-09-01T00:00:00.000Z",
                            "toDate": "2025-09-03T00:00:00.000Z",
                            "type": "conferenceDates",
                            "name": "Conference Date"
                        },
                        {
                            "fromDate": "2025-06-06T00:00:00.000Z",
                            "toDate": "2025-06-06T00:00:00.000Z",
                            "type": "submissionDate",
                            "name": "Full Paper Deadline"
                        },
                        {
                            "fromDate": "2025-06-06T00:00:00.000Z",
                            "toDate": "2025-06-06T00:00:00.000Z",
                            "type": "submissionDate",
                            "name": "Short Paper Deadline"
                        },
                        {
                            "fromDate": "2025-06-30T00:00:00.000Z",
                            "toDate": "2025-06-30T00:00:00.000Z",
                            "type": "notificationDate",
                            "name": "Acceptance Notification"
                        },
                        {
                            "fromDate": "2025-07-15T00:00:00.000Z",
                            "toDate": "2025-07-15T00:00:00.000Z",
                            "type": "cameraReadyDate",
                            "name": "Camera Ready Deadline"
                        },
                        {
                            "fromDate": "2010-06-30T00:00:00.000Z",
                            "toDate": "2025-07-10T00:00:00.000Z",
                            "type": "registrationDate",
                            "name": "Early Bird Registration"
                        }
                    ]
                }
            ]
        }
    ],
    "meta": {
        "curPage": 1,
        "perPage": 5,
        "totalItems": 546,
        "totalPage": 110,
        "prevPage": null,
        "nextPage": 2
    }
}