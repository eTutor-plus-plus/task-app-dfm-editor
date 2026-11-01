fact Purchase {
  quantity;
  price;
  {descriptive} accountHandler;
};
Purchase - customer;
Purchase - payment;
Purchase - purchaseDateTime;
Purchase - product;
dimension customer {
  customer - city - country;
  customer - city - {descriptive} zipCode;
  customer - city - {descriptive} cityName;
  customer ( -) ageGroup;
  customer - {descriptive} customerName;
};
dimension payment {
  payment ( -) moneyTransferPaymentId - bank;
  payment ( -) moneyTransferPaymentId - accountType;
  payment ( -) creditCardPaymentId - creditCardCompany;
  payment ( -) creditCardPaymentId - creditCardType;
  payment - paymentType;
  payment ( -) paymentDateTime - day - month - year;
};
dimension purchaseDateTime {
  purchaseDateTime - day - month -> year;
  purchaseDateTime - day - calendarWeek -> year;
};
dimension product {
  product - (brand) = category;
  product ( -) subDepartment - primaryDepartment;
  product ( -) subDepartment ( =) secondaryDepartment;
};
