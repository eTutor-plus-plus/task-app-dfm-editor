fact Sales { revenue; };
dimension time {
  time - day - month -> year;
  time - day - quarter -> year;
  time - day - calendarWeek -> year;
};
Sales - time;
