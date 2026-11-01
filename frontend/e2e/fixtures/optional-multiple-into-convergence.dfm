fact Sales { revenue; };
dimension product {
  product ( -) brand ( =) segment;
  product - category ( =) segment;
};
Sales - product;
