fact Sales { revenue; };
dimension time {
  time - day - month - quarter -> year;
  time - day - calendarWeek -> year;
};
Sales - time;
