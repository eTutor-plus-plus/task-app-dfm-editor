fact Sales {
  profit;
  quantity;
  {descriptive} clerk;
  {descriptive} comment;
};

dimension Time {
  day - month - year;
};

dimension Customer {
  customer -[livesIn]- city;
};

Sales -[bookedOn]- Time;
Sales -[boughtBy]- Customer;
