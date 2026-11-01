fact Purchase {
  quantity;
  price;
  {descriptive} accountHandler;
};
Purchase - purchaseDateTime;
dimension purchaseDateTime {
  purchaseDateTime - day - month -> year;
  purchaseDateTime - day - calendarWeek -> year;
};
