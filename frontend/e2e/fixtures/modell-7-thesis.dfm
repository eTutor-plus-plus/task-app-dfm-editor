fact Thesis {
  duration;
  finalGrade;
};
hierarchy month {
  month - year;
};
hierarchy schoolName {
  schoolName;
};
dimension ThesisDetails {
  thesis - ects;
  thesis -[started]- {shared} month;
  thesis -[handedIn]- {shared} month;
  thesis -[graded]- {shared} month;
  thesis -[author]- matriculationNo - gender;
  thesis -[author]- matriculationNo - nationality;
  thesis -[author]- matriculationNo - birthYear;
  thesis - curriculumName - earnedDegree;
  thesis - curriculumName - yearIntroduced;
  thesis - curriculumName - {shared} schoolName;
  thesis -[supervisor]- professorEmployeeNo - highestDegree;
  thesis -[supervisor]- professorEmployeeNo - jobTitle;
  thesis -[supervisor]- professorEmployeeNo - employedSinceYear;
  thesis -[supervisor]- professorEmployeeNo - professorNationality;
  thesis -[supervisor]- professorEmployeeNo - professorBirthYear;
  thesis -[supervisor]- professorEmployeeNo - type;
  thesis -[supervisor]- professorEmployeeNo - habilitationYear;
  thesis -[supervisor]- professorEmployeeNo - {descriptive} name;
  thesis -[supervisor]- professorEmployeeNo - {descriptive} headOfInstitute;
  thesis -[supervisor]- professorEmployeeNo - instituteName - {shared} schoolName;
};
Thesis - ThesisDetails;
