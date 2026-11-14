fact Evaluation {
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
};
dimension Semester {
  semester - year;
  semester - season;
};
dimension Student {
  student - birthYear;
  student - nationality;
  student - gender;
  student -[primaryStudies]- {shared} curriculum;
};
dimension Curriculum {
  {shared} curriculum;
};
Evaluation - Course;
Evaluation - Semester;
Evaluation - Student;
Evaluation - Curriculum;
