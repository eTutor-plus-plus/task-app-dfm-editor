fact Visit { duration; };
dimension visitor {
  visitor - age;
  visitor - gender;
  visitor - country;
  visitor - language;
  visitor - browser;
  visitor - device;
  visitor - screenSize;
  visitor - referrer;
  visitor - campaign;
  visitor - landingPage;
};
Visit - visitor;
