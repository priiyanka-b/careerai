// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INDIAN_CITIES = [
  "Bangalore", "Mumbai", "Delhi NCR", "Hyderabad", "Chennai", "Pune",
  "Kolkata", "Ahmedabad", "Noida", "Gurugram", "Jaipur", "Lucknow",
  "Chandigarh", "Kochi", "Coimbatore", "Indore", "Bhopal", "Vadodara",
  "Thiruvananthapuram", "Visakhapatnam", "Nagpur", "Surat", "Remote India"
];

const COMPANIES = {
  tech_giants: [
    { name: "Google India", type: "MNC", naukriSlug: "google-jobs-1", linkedinId: "1441" },
    { name: "Microsoft India", type: "MNC", naukriSlug: "microsoft-jobs-1", linkedinId: "1035" },
    { name: "Amazon India", type: "MNC", naukriSlug: "amazon-jobs-1", linkedinId: "1586" },
    { name: "Meta India", type: "MNC", naukriSlug: "meta-jobs-1", linkedinId: "10667" },
    { name: "Apple India", type: "MNC", naukriSlug: "apple-jobs-1", linkedinId: "162479" },
    { name: "IBM India", type: "MNC", naukriSlug: "ibm-jobs-1", linkedinId: "1009" },
    { name: "Oracle India", type: "MNC", naukriSlug: "oracle-jobs-1", linkedinId: "1normalized" },
    { name: "SAP India", type: "MNC", naukriSlug: "sap-jobs-1", linkedinId: "1373" },
    { name: "Salesforce India", type: "MNC", naukriSlug: "salesforce-jobs-1", linkedinId: "3653" },
    { name: "Adobe India", type: "MNC", naukriSlug: "adobe-jobs-1", linkedinId: "1090" },
    { name: "NVIDIA India", type: "MNC", naukriSlug: "nvidia-jobs-1", linkedinId: "7682" },
    { name: "Intel India", type: "MNC", naukriSlug: "intel-jobs-1", linkedinId: "1053" },
    { name: "Cisco India", type: "MNC", naukriSlug: "cisco-jobs-1", linkedinId: "1063" },
  ],
  indian_it: [
    { name: "TCS", type: "IT Services", naukriSlug: "tata-consultancy-services-jobs-1", linkedinId: "13922" },
    { name: "Infosys", type: "IT Services", naukriSlug: "infosys-jobs-1", linkedinId: "1283" },
    { name: "Wipro", type: "IT Services", naukriSlug: "wipro-jobs-1", linkedinId: "11198" },
    { name: "HCL Technologies", type: "IT Services", naukriSlug: "hcl-technologies-jobs-1", linkedinId: "397753" },
    { name: "Tech Mahindra", type: "IT Services", naukriSlug: "tech-mahindra-jobs-1", linkedinId: "17239" },
    { name: "LTIMindtree", type: "IT Services", naukriSlug: "ltimindtree-jobs-1", linkedinId: "73997290" },
    { name: "Mphasis", type: "IT Services", naukriSlug: "mphasis-jobs-1", linkedinId: "5012" },
    { name: "Persistent Systems", type: "IT Services", naukriSlug: "persistent-systems-jobs-1", linkedinId: "35660" },
    { name: "Hexaware", type: "IT Services", naukriSlug: "hexaware-technologies-jobs-1", linkedinId: "13949" },
    { name: "Birlasoft", type: "IT Services", naukriSlug: "birlasoft-jobs-1", linkedinId: "36233" },
    { name: "Zensar Technologies", type: "IT Services", naukriSlug: "zensar-technologies-jobs-1", linkedinId: "13961" },
    { name: "Coforge", type: "IT Services", naukriSlug: "coforge-jobs-1", linkedinId: "19104" },
  ],
  startups_unicorns: [
    { name: "Flipkart", type: "E-commerce", naukriSlug: "flipkart-jobs-1", linkedinId: "2360" },
    { name: "Paytm", type: "Fintech", naukriSlug: "paytm-jobs-1", linkedinId: "1353903" },
    { name: "Zomato", type: "Food Tech", naukriSlug: "zomato-jobs-1", linkedinId: "3044876" },
    { name: "Swiggy", type: "Food Tech", naukriSlug: "swiggy-jobs-1", linkedinId: "10800590" },
    { name: "Razorpay", type: "Fintech", naukriSlug: "razorpay-jobs-1", linkedinId: "5145556" },
    { name: "CRED", type: "Fintech", naukriSlug: "cred-jobs-1", linkedinId: "27220030" },
    { name: "PhonePe", type: "Fintech", naukriSlug: "phonepe-jobs-1", linkedinId: "9190228" },
    { name: "Zerodha", type: "Fintech", naukriSlug: "zerodha-jobs-1", linkedinId: "3461050" },
    { name: "Groww", type: "Fintech", naukriSlug: "groww-jobs-1", linkedinId: "18053184" },
    { name: "Meesho", type: "E-commerce", naukriSlug: "meesho-jobs-1", linkedinId: "11288088" },
    { name: "Nykaa", type: "E-commerce", naukriSlug: "nykaa-jobs-1", linkedinId: "3496917" },
    { name: "Urban Company", type: "Services", naukriSlug: "urban-company-jobs-1", linkedinId: "5091990" },
    { name: "Delhivery", type: "Logistics", naukriSlug: "delhivery-jobs-1", linkedinId: "4454583" },
    { name: "Freshworks", type: "SaaS", naukriSlug: "freshworks-jobs-1", linkedinId: "1853333" },
    { name: "Zoho", type: "SaaS", naukriSlug: "zoho-jobs-1", linkedinId: "671154" },
    { name: "BrowserStack", type: "Dev Tools", naukriSlug: "browserstack-jobs-1", linkedinId: "2525801" },
    { name: "Chargebee", type: "SaaS", naukriSlug: "chargebee-jobs-1", linkedinId: "2474840" },
    { name: "Cars24", type: "Auto Tech", naukriSlug: "cars24-jobs-1", linkedinId: "13522860" },
    { name: "Lenskart", type: "Retail", naukriSlug: "lenskart-jobs-1", linkedinId: "3002929" },
    { name: "PolicyBazaar", type: "InsurTech", naukriSlug: "policybazaar-jobs-1", linkedinId: "1288097" },
  ],
  consulting_finance: [
    { name: "Deloitte India", type: "Consulting", naukriSlug: "deloitte-jobs-1", linkedinId: "1038" },
    { name: "PwC India", type: "Consulting", naukriSlug: "pwc-jobs-1", linkedinId: "4040" },
    { name: "EY India", type: "Consulting", naukriSlug: "ernst-young-jobs-1", linkedinId: "1073" },
    { name: "KPMG India", type: "Consulting", naukriSlug: "kpmg-jobs-1", linkedinId: "3002" },
    { name: "Accenture India", type: "Consulting", naukriSlug: "accenture-jobs-1", linkedinId: "1033" },
    { name: "Goldman Sachs India", type: "Finance", naukriSlug: "goldman-sachs-jobs-1", linkedinId: "1081" },
    { name: "JP Morgan India", type: "Finance", naukriSlug: "jpmorgan-chase-jobs-1", linkedinId: "1067" },
    { name: "Barclays India", type: "Finance", naukriSlug: "barclays-jobs-1", linkedinId: "3101" },
  ],
};

const JOB_ROLES = {
  engineering: [
    { title: "Software Engineer", level: "Entry/Mid", salary: "8-25 LPA" },
    { title: "Senior Software Engineer", level: "Senior", salary: "18-45 LPA" },
    { title: "Staff Software Engineer", level: "Staff", salary: "40-80 LPA" },
    { title: "Engineering Manager", level: "Manager", salary: "45-90 LPA" },
    { title: "Full Stack Developer", level: "Mid", salary: "10-30 LPA" },
    { title: "Frontend Developer", level: "Mid", salary: "8-25 LPA" },
    { title: "Backend Developer", level: "Mid", salary: "10-28 LPA" },
    { title: "DevOps Engineer", level: "Mid", salary: "12-35 LPA" },
    { title: "Site Reliability Engineer", level: "Mid/Senior", salary: "15-45 LPA" },
    { title: "Cloud Engineer", level: "Mid", salary: "12-35 LPA" },
    { title: "QA Engineer", level: "Entry/Mid", salary: "5-18 LPA" },
    { title: "Security Engineer", level: "Mid/Senior", salary: "15-45 LPA" },
    { title: "Mobile Developer", level: "Mid", salary: "10-30 LPA" },
    { title: "React Native Developer", level: "Mid", salary: "10-28 LPA" },
  ],
  data: [
    { title: "Data Scientist", level: "Mid", salary: "12-35 LPA" },
    { title: "Senior Data Scientist", level: "Senior", salary: "25-55 LPA" },
    { title: "Machine Learning Engineer", level: "Mid/Senior", salary: "15-50 LPA" },
    { title: "AI Engineer", level: "Mid/Senior", salary: "18-60 LPA" },
    { title: "Data Engineer", level: "Mid", salary: "12-35 LPA" },
    { title: "Data Analyst", level: "Entry/Mid", salary: "6-18 LPA" },
    { title: "Business Analyst", level: "Mid", salary: "8-22 LPA" },
    { title: "MLOps Engineer", level: "Mid/Senior", salary: "15-45 LPA" },
    { title: "NLP Engineer", level: "Mid/Senior", salary: "15-45 LPA" },
  ],
  product: [
    { title: "Product Manager", level: "Mid", salary: "15-40 LPA" },
    { title: "Senior Product Manager", level: "Senior", salary: "30-65 LPA" },
    { title: "Associate Product Manager", level: "Entry", salary: "10-20 LPA" },
    { title: "Technical Program Manager", level: "Mid/Senior", salary: "20-50 LPA" },
    { title: "Scrum Master", level: "Mid", salary: "10-25 LPA" },
  ],
  design: [
    { title: "UX Designer", level: "Mid", salary: "8-25 LPA" },
    { title: "Product Designer", level: "Mid/Senior", salary: "12-35 LPA" },
    { title: "UI Designer", level: "Mid", salary: "7-22 LPA" },
    { title: "Design Lead", level: "Senior", salary: "25-50 LPA" },
  ],
  sales_marketing: [
    { title: "Business Development Manager", level: "Mid", salary: "10-30 LPA" },
    { title: "Digital Marketing Manager", level: "Mid", salary: "8-22 LPA" },
    { title: "Growth Manager", level: "Mid", salary: "12-35 LPA" },
    { title: "Account Executive", level: "Mid", salary: "8-25 LPA" },
    { title: "Performance Marketing Manager", level: "Mid", salary: "10-28 LPA" },
  ],
  operations: [
    { title: "Operations Manager", level: "Mid", salary: "8-22 LPA" },
    { title: "Customer Success Manager", level: "Mid", salary: "8-22 LPA" },
    { title: "Technical Support Engineer", level: "Entry/Mid", salary: "4-12 LPA" },
    { title: "Supply Chain Manager", level: "Mid", salary: "10-28 LPA" },
  ],
  internships: [
    { title: "Software Engineering Intern", level: "Intern", salary: "20K-60K/month" },
    { title: "Data Science Intern", level: "Intern", salary: "25K-50K/month" },
    { title: "Product Management Intern", level: "Intern", salary: "30K-60K/month" },
    { title: "Machine Learning Intern", level: "Intern", salary: "30K-70K/month" },
    { title: "Frontend Development Intern", level: "Intern", salary: "15K-35K/month" },
    { title: "Backend Development Intern", level: "Intern", salary: "20K-40K/month" },
    { title: "Design Intern", level: "Intern", salary: "15K-40K/month" },
    { title: "Marketing Intern", level: "Intern", salary: "10K-25K/month" },
    { title: "Business Development Intern", level: "Intern", salary: "15K-30K/month" },
  ],
};

const SKILLS_BY_ROLE: Record<string, string[]> = {
  "Software Engineer": ["JavaScript", "Python", "Java", "React", "Node.js", "SQL", "Git", "AWS"],
  "Data Scientist": ["Python", "Machine Learning", "SQL", "TensorFlow", "PyTorch", "Statistics", "Pandas"],
  "Product Manager": ["Product Strategy", "Agile", "User Research", "Analytics", "Roadmapping"],
  "DevOps Engineer": ["AWS", "Docker", "Kubernetes", "CI/CD", "Terraform", "Linux"],
  "Full Stack Developer": ["React", "Node.js", "TypeScript", "MongoDB", "PostgreSQL", "REST APIs"],
  "Machine Learning Engineer": ["Python", "TensorFlow", "PyTorch", "MLOps", "Deep Learning", "NLP"],
  "UX Designer": ["Figma", "User Research", "Wireframing", "Prototyping", "Design Systems"],
  "AI Engineer": ["Python", "LLMs", "PyTorch", "NLP", "Vector Databases", "MLOps"],
  "Data Engineer": ["Python", "Spark", "Airflow", "SQL", "AWS", "dbt", "Kafka"],
  "Frontend Developer": ["React", "TypeScript", "CSS", "HTML", "Next.js", "Redux"],
  "Backend Developer": ["Node.js", "Python", "Java", "PostgreSQL", "Redis", "REST APIs"],
};

function getSkills(roleTitle: string): string[] {
  for (const [key, skills] of Object.entries(SKILLS_BY_ROLE)) {
    if (roleTitle.includes(key.split(" ")[0])) return skills;
  }
  return ["Communication", "Problem Solving", "Teamwork", "Analytical Thinking"];
}

// Generate always-working job board search URLs
function generateJobUrl(
  company: { name: string; naukriSlug: string; linkedinId: string },
  role: string,
  isInternship: boolean,
  city: string
): string {
  const encodedRole = encodeURIComponent(role);
  const encodedCity = encodeURIComponent(city === "Remote India" ? "India" : city);

  if (isInternship) {
    // Internshala search — always works
    const keyword = role.toLowerCase()
      .replace(" intern", "")
      .replace(/\s+/g, "-");
    return `https://internshala.com/internships/${keyword}-internship-in-${encodedCity.toLowerCase()}`;
  }

  // Randomly pick between Naukri and LinkedIn — both always work
  const useLinkedIn = Math.random() > 0.5;

  if (useLinkedIn) {
    return `https://www.linkedin.com/jobs/search/?keywords=${encodedRole}&location=${encodedCity}%2C+India&f_C=${company.linkedinId}`;
  } else {
    return `https://www.naukri.com/${company.naukriSlug}?title=${encodedRole}`;
  }
}

function generateJobDescription(role: string, company: string, companyType: string): string {
  const skills = getSkills(role);
  return `${company} is looking for a talented ${role} to join our team.

As a ${role}, you will:
• Design, develop, and maintain high-quality solutions
• Collaborate with cross-functional teams to deliver impactful products
• Drive innovation and solve complex technical challenges
• Contribute to best practices and team culture

Requirements:
• Strong expertise in ${skills.slice(0, 3).join(", ")}
• Proficiency in ${skills.slice(3, 6).join(", ")}
• Excellent problem-solving and communication skills
• ${companyType === "Fintech" || companyType === "E-commerce" || companyType === "Food Tech"
    ? "Startup mindset with ability to thrive in fast-paced environment"
    : "Experience working in large-scale environments"}

What we offer:
• Competitive compensation with ESOPs
• Health insurance for you and family  
• Flexible work arrangements
• Learning & development budget
• Modern tech stack and great engineering culture`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { count = 500, location = "all", category = "all" } = await req.json();

    console.log(`Generating ${count} India-focused jobs — location: ${location}, category: ${category}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const allCompanies = [
      ...COMPANIES.tech_giants,
      ...COMPANIES.indian_it,
      ...COMPANIES.startups_unicorns,
      ...COMPANIES.consulting_finance,
    ];

    // Pick roles by category
    let rolePool: any[] = [];
    if (category === "all") {
      rolePool = Object.values(JOB_ROLES).flat();
    } else if (JOB_ROLES[category as keyof typeof JOB_ROLES]) {
      rolePool = JOB_ROLES[category as keyof typeof JOB_ROLES];
    } else {
      rolePool = Object.values(JOB_ROLES).flat();
    }

    const targetLocations = location === "all" ? INDIAN_CITIES : [location];
    const jobs: any[] = [];

    for (let i = 0; i < count; i++) {
      const company = allCompanies[Math.floor(Math.random() * allCompanies.length)];
      const role = rolePool[Math.floor(Math.random() * rolePool.length)];
      const city = targetLocations[Math.floor(Math.random() * targetLocations.length)];
      const isInternship = role.level === "Intern";

      const postedDaysAgo = Math.floor(Math.random() * 14);
      const postedDate = new Date();
      postedDate.setDate(postedDate.getDate() - postedDaysAgo);

      const source = isInternship
        ? "Internshala"
        : Math.random() > 0.5 ? "LinkedIn" : "Naukri";

      jobs.push({
        title: role.title,
        company: company.name,
        location: city,
        description: generateJobDescription(role.title, company.name, company.type),
        url: generateJobUrl(company, role.title, isInternship, city),
        source,
        salary_range: role.salary,
        job_type: isInternship ? "internship" : "job",
        external_id: `india-${company.name.toLowerCase().replace(/\s+/g, '-')}-${role.title.toLowerCase().replace(/\s+/g, '-')}-${city.toLowerCase().replace(/\s+/g, '-')}-${i}-${Date.now()}`,
        posted_date: postedDate.toISOString(),
        fetched_at: new Date().toISOString(),
      });
    }

    console.log(`Generated ${jobs.length} jobs, inserting into database...`);

    const batchSize = 100;
    let insertedCount = 0;

    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      const { error } = await supabase
        .from("job_postings")
        .upsert(batch, { onConflict: "external_id", ignoreDuplicates: true });

      if (error) {
        console.error(`Batch error ${i / batchSize + 1}:`, error);
      } else {
        insertedCount += batch.length;
      }
    }

    console.log(`Successfully seeded ${insertedCount} jobs`);

    return new Response(
      JSON.stringify({
        success: true,
        jobsGenerated: jobs.length,
        jobsInserted: insertedCount,
        message: `Seeded ${insertedCount} India-focused jobs across ${targetLocations.length} cities`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in seed-india-jobs:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});