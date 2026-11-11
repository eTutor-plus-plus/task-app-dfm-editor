fact Sales {
  profit;
};

dimension Customer {
  customer - country;
};

dimension Store {
  store - city;
};

Sales -[purchasedByCustomerInStore]- Customer;
Sales -[soldInShortStore]- Store;
