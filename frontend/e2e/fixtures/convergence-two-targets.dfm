fact Sales { revenue; };
dimension time {
  time - day - month -> year;
  time - day - calendarWeek -> year;
  time - day - fiscalMonth -> fiscalYear;
  time - day - fiscalWeek -> fiscalYear;
};
Sales - time;
