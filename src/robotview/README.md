# robotview

This folder contains some experimental work to add an interactive ui to lean.

The idea is to use a react extension to make a new web-view controller.

There are essentially two approaches of varying ambition;

way 1 is to write a web framework in lean.
way 2 is to get lean to export json and then write the code in React.


## Way 1

There is a type `html α`, α is the type of actions available.




