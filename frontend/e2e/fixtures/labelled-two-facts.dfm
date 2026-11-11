fact Sales {
  revenue;
};

fact Returns {
  refunded;
};

dimension Store {
  store -[locatedIn]- city - region;
};

dimension Product {
  product - category;
};

dimension ReturnStore {
  returnStore -[locatedIn]- returnCity;
};

Sales -[soldAt]- Store;
Sales -[sells]- Product;
Returns -[returnedAt]- ReturnStore;
