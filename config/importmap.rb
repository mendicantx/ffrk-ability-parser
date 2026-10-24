# Pin npm packages by running ./bin/importmap

pin "application"
pin_all_from "app/javascript/pages", under: "pages"
pin_all_from "app/javascript/ffrk", under: "ffrk"
