fact Sales {
    profit;
};

dimension Customer {
    Customer -[customerCountry]- country;
};

dimension City {
  City = region;
  City - {descriptive} zipcode;
  City - {descriptive} population;
  City - country - continent;
};

Sales - Customer;
Sales -[storeCity]- City;
