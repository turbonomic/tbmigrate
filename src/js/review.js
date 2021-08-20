// :credentials: not_required

var vars = {
	classic: getenv("branding_classic"),
	xl: getenv("branding_xl"),
	isIwo: getenv("branding_isIwo"),
	isCwmon: getenv("branding_isCwom"),
	vendor: getenv("branding_vendor"),
	product: getenv("branding_product"),
	review_url: getenv("branding_review_url"),
	step_creds: getenv("step_creds"),
	step_collect_1: getenv("step_collect_1"),
	step_targets_1: getenv("step_targets_1"),
	step_match: getenv("step_match"),
	step_collect_2: getenv("step_collect_2"),
	step_groups_1: getenv("step_groups_1"),
	step_targets_2: getenv("step_targets_2"),
	step_collect_3: getenv("step_collect_3"),
	step_groups_2: getenv("step_groups_2"),
	step_templates: getenv("step_templates"),
	step_policies: getenv("step_policies"),
	step_users: getenv("step_users"),
	step_review: getenv("step_review")
};

var funcs = {
	ifelse: function(cond, a, b) {
		return cond ? a : b;
	},
	cat: function() {
		var list = [ ];
		for (var i=0; i < arguments.length; i +=1 ) { list.push(arguments[i]); }
		return list.join("");
	}
};

print(template("REVIEW.md", vars, funcs));
