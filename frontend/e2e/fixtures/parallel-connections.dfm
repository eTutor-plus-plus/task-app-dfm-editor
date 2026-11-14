fact Thesis { duration; };
hierarchy month { month - year; };
dimension ThesisDetails {
  thesis -[started]- {shared} month;
  thesis (-[handedIn]-) {shared} month;
  thesis =[graded]= {shared} month;
};
Thesis (-[author]-) ThesisDetails;
Thesis =[reviewer]= ThesisDetails;
