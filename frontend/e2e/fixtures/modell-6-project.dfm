fact Project {
  duration;
  noOfPublications;
};
dimension PartnerInstitution {
  partnerInstitutionName - partnerInstitutionCountry;
};
dimension FundingAgency {
  fundingAgencyName - fundingAgencyCountry;
};
dimension Start {
  startMonth - startYear;
};
dimension End {
  endMonth - endYear;
};
dimension Professor {
  professor - {descriptive} name;
  professor - highestDegree;
  professor - jobTitle;
  professor - employedSinceYear;
  professor - nationality;
  professor - birthYear;
  professor - type;
  professor - habilitationYear;
  professor - instituteName - schoolName;
};
Project - PartnerInstitution;
Project - FundingAgency;
Project - Start;
Project - End;
Project -[principalInvestigator]- Professor;
