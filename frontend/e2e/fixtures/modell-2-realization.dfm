fact Realization {
  enrollments;
  studentsPassingCourse;
};
// School wird von beiden Hierarchien gemeinsam verwendet.
hierarchy school {
  school;
};
dimension Teacher {
  teacher - institute - {shared} school;
  teacher - {descriptive} name;
};
dimension Semester {
  semester - season;
  semester - year;
};
dimension Course {
  course - courseType;
  course - {descriptive} hoursPerWeek;
  course - {descriptive} workload;
  course - {descriptive} name;
  course = module - subject - curriculum - {shared} school;
  course = module - {descriptive} moduleName;
  course = module - {descriptive} moduleWorkload;
  course = module - subject - {descriptive} subjectName;
  course = module - subject - {descriptive} subjectWorkload;
  course = module - subject - curriculum - {descriptive} earnedDegree;
  course = module - subject - curriculum - {descriptive} yearIntroduced;
};
Realization - Teacher;
Realization - Semester;
Realization - Course;
