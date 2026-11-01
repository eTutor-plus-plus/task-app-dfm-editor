fact Measurement { value; };
dimension dim1 {
  dim1 - dim1Level1 - dim1Level2;
  dim1 - {descriptive} dim1Name;
};
dimension dim2 {
  dim2 - dim2Level1 - dim2Level2;
  dim2 - {descriptive} dim2Name;
};
Measurement - dim1;
Measurement - dim2;
