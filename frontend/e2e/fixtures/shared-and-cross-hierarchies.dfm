fact Sales {
    profit;
};

hierarchy VAT {
    VAT - vatClass;
};

hierarchy city {
    city = region;
    city - country - continent;
    city - country - {cross} VAT;
    city - {descriptive} zipCode;
    city - {descriptive} population;
};

dimension city {
    {shared} city;
};

dimension customer {
    customer -[customerCity]- {shared} city;
};

dimension product {
    product - brand;
    product - category - {cross} VAT;
};

Sales -[storeCity]- city;
Sales - customer;
Sales - product;
