const { Configuration, OpenAIApi } = require("openai"),
  express = require("express"),
  multer = require("multer"),
  cors = require("cors"),
  multerS3 = require("multer-s3"),
  AWS = require("aws-sdk"),
  dotenv = require("dotenv").config();

const app = express(),
  port = process.env.PORT || 4000,
  bucket = "files",
  s3 = new AWS.S3({
    endpoint: process.env.S3_BUCKET_ENDPOINT,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    sslEnabled: false,
    s3ForcePathStyle: true,
  });

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

const database = [];
let workArray = [],
  applicantName = "",
  technologies = "";

// Generates a random id for each resume entry
const generateID = () => Math.random().toString(36).substring(2, 10);

// Convert workArray into string format
const remainderText = () => {
  return workArray
    .map((item) => `${item.name} as a ${item.position}.`)
    .join(" ");
};

// Generates response text using Open AI's GPT function
const generateResponse = async (prompt) => {
  const response = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: prompt,
    temperature: 0.6,
    max_tokens: 350,
    top_p: 1,
    frequency_penalty: 1,
    presence_penalty: 1,
  });
  return response.data.choices[0].text;
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

app.post(
  "/resume/create",
  multer({
    storage: multerS3({
      s3,
      bucket,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      metadata: (req, file, cb) => {
        cb(null, { fieldName: file.fieldname });
      },
      key: (req, file, cb) => {
        cb(null, Date.now().toString());
      },
    }),
  }).single("headshotImage"),
  async (req, res) => {
    const {
      fullName,
      currentPosition,
      currentLength,
      currentTechnologies,
      workHistory,
    } = req.body;

    workArray = JSON.parse(workHistory);
    applicantName = fullName;
    technologies = currentTechnologies;

    const newEntry = {
      id: generateID(),
      fullName,
      image_url: `${process.env.S3_BUCKET_ENDPOINT}/files/${req.file.key}`,
      currentPosition,
      currentLength,
      currentTechnologies,
      workHistory: workArray,
    };

    const prompt1 = `I am writing a resume, my details are \n name: ${fullName} \n role: ${currentPosition} (${currentLength} years). \n I work proficiently with these technologies: ${currentTechnologies}. Can you write a 100 word introduction for the top of the resume(first person writing)?`;

    const prompt2 = `I am writing a resume, my details are \n name: ${fullName} \n role: ${currentPosition} (${currentLength} years). \n I  work proficiently with these technologies: ${currentTechnologies}. Can you write me a list of soft skills seperated by numbers a person in this role will possess?. The list should be suitable for a resume (in first person)? Do not write "The end" at the end of the list!!!`;

    const prompt3 = `I am writing a resume, my details are \n name: ${fullName} \n role: ${currentPosition}. \n During my years I worked at ${
      workArray.length
    } companies. ${remainderText()} \n Can you write me 50 words for each company, pertaining to my success each company(in first person, and seperated in numbers)?`;

    const objective = await generateResponse(prompt1);
    const keypoints = await generateResponse(prompt2);
    const jobResponsibilities = await generateResponse(prompt3);

    const chatgptData = { objective, keypoints, jobResponsibilities };
    const data = { ...newEntry, ...chatgptData };
    database.push(data);

    res.json({
      message: "Request successful!",
      data,
    });
  }
);

app.post(
  "/resume/send",
  multer({
    storage: multerS3({
      s3,
      bucket,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      metadata: (req, file, cb) => {
        cb(null, { fieldName: file.fieldname });
      },
      key: (req, file, cb) => {
        cb(null, Date.now().toString());
      },
    }),
  }).single("resume"),
  async (req, res) => {
    const {
      applicantName,
      recruiterName,
      jobTitle,
      myEmail,
      recruiterEmail,
      companyName,
      companyDescription,
    } = req.body;

    const prompt = `My name is ${applicantName}. I want to work for ${companyName}, they are ${companyDescription}
    I am applying for the role of ${jobTitle}. I have previously worked for: ${remainderText()}
    And I have used technologies such as ${technologies}
    I want to cold email ${recruiterName} from ${applicantName} my resume and write why I'm a phenomenal fit for the company.
    Can you please write me the email in a friendly voice, not official? without subject, maximum 300 words and say in the end that my CV is attached.`;

    const coverLetter = await generateResponse(prompt);

    res.json({
      message: "Successful",
      data: {
        cover_letter: coverLetter,
        recruiter_email: recruiterEmail,
        my_email: myEmail,
        applicant_name: applicantName,
        resume: `${process.env.S3_BUCKET_ENDPOINT}/files/${req.file.key}`,
      },
    });
  }
);

app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});

app.get("/", (req, res) => {
  res.send("Hey this is my API running 🥳");
});

app.post(
  "/upload",
  multer({
    storage: multerS3({
      s3,
      bucket,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      metadata: (req, file, cb) => {
        cb(null, { fieldName: file.fieldname });
      },
      key: (req, file, cb) => {
        cb(null, Date.now().toString());
      },
    }),
  }).single("file"),
  (req, res) => {
    return res.json({ message: req.file.location });
  }
);

app.delete("/remove/:key", async (req, res) => {
  const params = { Bucket: bucket, Key: req.params.key };

  let file;

  try {
    file = await s3.headObject(params).promise();
  } catch (error) {
    return res.status(404).json({ message: "File not found" });
  }

  if (file) {
    try {
      await s3.deleteObject(params).promise();
    } catch (error) {
      return res.status(500).json({ message: "Could not delete file" });
    }
  }

  return res.json({ message: "File deleted" });
});
