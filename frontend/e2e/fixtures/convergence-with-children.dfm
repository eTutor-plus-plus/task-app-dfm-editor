fact Sales { revenue; };
dimension time {
  time - day - month -> year - decade;
  time - day - calendarWeek -> year;
};
Sales - time;
