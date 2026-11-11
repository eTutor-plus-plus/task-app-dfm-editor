fact Orders {
  amount;
};

dimension Product {
  product -[belongsTo]- category -[partOf]-> department;
  product =[suppliedBy]= supplier;
  category (-[optionalLink]-) brand;
  brand (=[ownedBy]=) company;
};

Orders - Product;
