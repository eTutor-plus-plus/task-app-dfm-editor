fact Evaluation_1MNF {
  overallQualityScore;
  didacticQualityScore;
  contentQualityScore;
  effortPerWeek;
  finalGrade;
};
hierarchy curriculum {
  curriculum - school;
};
dimension Enrollment {
  enrollment - realization - course - courseType;
  enrollment - realization - course - {descriptive} name;
  enrollment - realization - course - {descriptive} workload;
  enrollment - realization - course - {descriptive} hoursPerWeek;
  enrollment - realization - semester - year;
  enrollment - realization - semester - season;
  enrollment - student - birthYear;
  enrollment - student - nationality;
  enrollment - student - gender;
  enrollment - student -[primaryStudies]- {shared} curriculum;
  enrollment - {shared} curriculum;
};
Evaluation_1MNF - Enrollment;
