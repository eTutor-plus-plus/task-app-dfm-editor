fact Claim { amount; {descriptive} caseNumber; };
dimension policy {
  policy ( -) rider - riderType;
  policy - (coverage) = coverageGroup;
  policy ( -) holder ( =) coHolder;
  policy - {descriptive} policyNumber;
};
Claim - policy;
