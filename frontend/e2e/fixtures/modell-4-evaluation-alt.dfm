fact Evaluation_1MNF_Alt {
  overallQualityScore;
  didacticQualityScore;
  contentQualityScore;
  effortPerWeek;
  finalGrade;
};
hierarchy curriculum {
  curriculum - school;
};
dimension Course {
  course - courseType;
  course - {descriptive} name;
  course - {descriptive} workload;
  course - {descriptive} hoursPerWeek;
  course - {cross} curriculum;
};
dimension Semester {
  semester - year;
  semester - season;
  semester - {cross} curriculum;
};
dimension Student {
  student - birthYear;
  student - nationality;
  student - gender;
  student -[enrollment]- {cross} curriculum;
};
Evaluation_1MNF_Alt - Course;
Evaluation_1MNF_Alt - Semester;
Evaluation_1MNF_Alt - Student;
