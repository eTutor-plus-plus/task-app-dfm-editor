fact Sales {
  revenue;
  {descriptive} salesperson;
};
fact Returns {
  refundAmount;
  reason;
};
dimension time {
  day - month - year;
  day - week -> year;
};
dimension product {
  product - category - department;
  product - brand;
};
dimension returnReason {
  reason - reasonGroup;
};
Sales - time;
Sales - product;
Returns - returnReason;
